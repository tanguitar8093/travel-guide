import 'fake-indexeddb/auto'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LocalSyncStore } from './local-sync.store'
import { SyncDatabase } from './sync.database'
import { SyncAccountContext } from './sync-account-context'
import { syncHybridManually } from './sync-engine'
import { previewHybridSync } from './sync-preview'
import { prepareConflictReview, resolveConflictReview } from './sync-conflicts'
import { BackupRepository } from './backup.repository'
import type { CloudSyncPull, CloudSyncPush, CloudSyncSnapshot } from './sync-cloud.adapter'
import type { SyncTask } from './sync.types'
import type { SharedTripSnapshot } from './shared-trip.types'
import { parseSharedTripSnapshot } from './shared-trip.validation'
import type { PublicSnapshot } from '../modules/public-itinerary/models'
import { accountOsmRegionId, DEFAULT_OSM_REGION } from '../geo/osm-coverage'

const sql = new PGlite()
const migrations = import.meta.glob<string>('../../supabase/migrations/*.sql', { eager: true, query: '?raw', import: 'default' })
const member = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const admin = '33333333-3333-4333-8333-333333333333'
const basic = '44444444-4444-4444-8444-444444444444'
const location = {
  source: 'osm', kind: 'point', reference: { provider: 'osm', id: 'node/123' },
  datasetVersion: 'okinawa-test', coordinate: { latitude: 26.4, longitude: 127.9 },
} as const
const lock = async (_name: string, work: () => Promise<void>) => work()

async function asUser<T>(uid: string, work: () => Promise<T>): Promise<T> {
  await sql.exec('begin; set local role authenticated')
  await sql.query("select set_config('request.jwt.claim.sub',$1,true)", [uid])
  try {
    const result = await work()
    await sql.exec('commit')
    return result
  } catch (cause) {
    await sql.exec('rollback')
    throw cause
  }
}
async function rpc<T>(name: string, parameters: unknown[] = []): Promise<T> {
  const placeholders = parameters.map((_, i) => `$${i + 1}`).join(',')
  return (await sql.query<{ value: T }>(`select public.${name}(${placeholders}) as value`, parameters)).rows[0].value
}
function adapter(uid: string) {
  return {
    snapshot: () => asUser(uid, () => rpc<CloudSyncSnapshot>('app_sync_snapshot')),
    pull: (cursor: string) => asUser(uid, () => rpc<CloudSyncPull>('app_sync_pull', [cursor, 1])),
    push: (task: SyncTask) => asUser(uid, () => rpc<CloudSyncPush>('app_sync_push', [{
      protocolVersion: task.protocolVersion, operationId: task.operationId, account: task.account, changes: task.changes,
    }])),
  }
}
async function fixture(uid = member) {
  const regionId = crypto.randomUUID(), placeId = crypto.randomUUID(), tripId = crypto.randomUUID()
  await asUser(uid, async () => {
    await sql.query(`insert into public.regions(id,name,map_provider,center,center_metadata,zoom)
      values($1,'Okinawa','osm',$2,$3,9.5)`, [regionId, DEFAULT_OSM_REGION.center, DEFAULT_OSM_REGION.centerMetadata])
    await rpc('app_save_place', [placeId, { name: 'OSM place', location, regionIds: [regionId], labelIds: [] }, true])
    await sql.query(`insert into public.trips(id,region_id,name,start_date,end_date)
      values($1,$2,'Geo trip','2026-10-23','2026-10-24')`, [tripId, regionId])
    await sql.query(`insert into public.itinerary_items(id,trip_id,place_id,date,sort_order)
      values($1,$2,$3,'2026-10-23',0)`, [crypto.randomUUID(), tripId, placeId])
  })
  return { regionId, placeId, tripId }
}

beforeAll(async () => {
  await sql.exec(`
    create role anon; create role authenticated; create role service_role bypassrls; create role supabase_admin;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
  `)
  for (const path of Object.keys(migrations).sort()) {
    await sql.exec(migrations[path].replace('create extension if not exists pgcrypto;', ''))
  }
  await sql.exec(`insert into auth.users values
    ('${member}','member@example.com'),('${other}','other@example.com'),
    ('${admin}','admin@example.com'),('${basic}','basic@example.com');
    update public.user_roles set role='member' where user_id in ('${member}','${other}');
    update public.user_roles set role='admin' where user_id='${admin}';`)
}, 120000)
afterAll(async () => { await sql.close() })

describe('new geo contract on the existing local-first sync', () => {
  it('commits locally before upload, retries the frozen task and restores all fields on a second device', async () => {
    const storage = new SyncDatabase({ projectId: crypto.randomUUID(), userId: member })
    const second = new SyncDatabase({ projectId: crypto.randomUUID(), userId: member })
    const context = new SyncAccountContext(), secondContext = new SyncAccountContext()
    context.activate(storage.account)
    secondContext.activate(second.account)
    const store = new LocalSyncStore(storage, context), secondStore = new LocalSyncStore(second, secondContext)
    await store.prepareLocal()
    await secondStore.prepareLocal()
    const cloud = adapter(member)
    try {
      const ids = await store.mutate('geo.graph', async repos => {
        const region = await repos.regions.create({ ...DEFAULT_OSM_REGION, zoom: 9.5 })
        const place = await repos.places.create({ name: 'Local OSM', location, regionIds: [region], labelIds: [] })
        const trip = await repos.trips.create({ regionId: region, name: 'Local trip', startDate: '2026-10-23', endDate: '2026-10-24' })
        const map = await repos.routeMaps.create({ name: 'Map', tripId: trip, transport: 'WALKING' })
        const marker = await repos.routeMapPlaces.create({ routeMapId: map, name: 'Marker', location })
        await repos.routeMaps.update(map, {
          origin: { kind: 'place', placeId: place }, destination: { kind: 'route-map-place', routeMapPlaceId: marker },
        })
        return { region, place, trip, map, marker }
      })
      expect(await storage.places.get(ids.place)).toMatchObject({ location })
      expect((await sql.query('select id from public.places where id=$1', [ids.place])).rows).toEqual([])
      expect(await store.listTasks()).toHaveLength(1)
      let lost = false
      const unreliable = { ...cloud, push: async (task: SyncTask) => {
        const result = await cloud.push(task)
        if (!lost) { lost = true; throw new Error('Lost response') }
        return result
      } }
      await expect(syncHybridManually(store, unreliable, lock)).rejects.toThrow('Lost response')
      const frozen = (await store.listTasks())[0].uploadChanges
      expect(frozen).toBeDefined()
      await syncHybridManually(store, cloud, lock)
      expect(await store.listTasks()).toEqual([])
      await syncHybridManually(secondStore, cloud, lock)
      expect(await second.regions.get(ids.region)).toMatchObject({ mapProvider: 'osm', centerMetadata: DEFAULT_OSM_REGION.centerMetadata, zoom: 9.5 })
      expect(await second.places.get(ids.place)).toMatchObject({ location })
      expect(await second.routeMapPlaces.get(ids.marker)).toMatchObject({ location })
      expect(await second.routeMaps.get(ids.map)).toMatchObject({
        origin: { kind: 'place', placeId: ids.place }, destination: { kind: 'route-map-place', routeMapPlaceId: ids.marker },
      })
      expect((await previewHybridSync(secondStore, cloud)).rows.every(row => row.difference === 'same')).toBe(true)
      await store.mutate('rename.local', repos => repos.places.update(ids.place, { name: 'Local choice' }))
      await asUser(member, () => sql.query("update public.places set name='Cloud choice' where id=$1", [ids.place]))
      await expect(syncHybridManually(store, cloud, lock)).rejects.toThrow('衝突')
      const review = await prepareConflictReview(store, cloud, lock)
      await resolveConflictReview(store, review.token, 'local', cloud, lock)
      await syncHybridManually(store, cloud, lock)
      expect(await storage.places.get(ids.place)).toMatchObject({ name: 'Local choice', location })
      await store.mutate('delete.marker', repos => repos.routeMapPlaces.delete(ids.marker))
      await syncHybridManually(store, cloud, lock)
      await syncHybridManually(secondStore, cloud, lock)
      expect((await second.routeMaps.get(ids.map))?.destination).toBeUndefined()
    } finally {
      await storage.delete()
      await second.delete()
    }
  })

  it('keeps geo constraints, owner isolation, admin access and atomic relations on direct cloud writes', async () => {
    const { regionId, placeId } = await fixture()
    await expect(asUser(other, () => rpc('app_save_place', [placeId, {
      name: 'Stolen', location, regionIds: [regionId], labelIds: [],
    }, false]))).rejects.toThrow()
    await expect(asUser(other, () => rpc('app_save_place', [crypto.randomUUID(), {
      name: 'Cross owner', location, regionIds: [regionId], labelIds: [],
    }, true]))).rejects.toThrow()
    await expect(asUser(basic, () => rpc('app_save_place', [crypto.randomUUID(), {
      name: 'Basic', location, regionIds: [regionId], labelIds: [],
    }, true]))).rejects.toThrow()
    await asUser(admin, () => rpc('app_save_place', [placeId, { name: 'Admin edit', location, regionIds: [regionId], labelIds: [] }, false]))
    expect((await sql.query<{ owner_uid: string }>('select owner_uid from public.places where id=$1', [placeId])).rows[0].owner_uid).toBe(member)
    await expect(asUser(member, () => sql.query('update public.places set location=$1 where id=$2', [
      { ...location, source: 'google' }, placeId,
    ]))).rejects.toThrow()
    await expect(asUser(member, () => rpc('app_save_place', [placeId, { name: 'Orphan', location, regionIds: [], labelIds: [] }, false]))).rejects.toThrow()
    expect((await sql.query<{ name: string }>('select name from public.places where id=$1', [placeId])).rows[0].name).toBe('Admin edit')
    await expect(asUser(member, () => sql.query(`insert into public.route_maps(name,transport,origin)
      values('Invalid endpoint','WALKING',$1)`, [{ kind: 'place', placeId: crypto.randomUUID() }]))).rejects.toThrow()
    await asUser(member, async () => {
      await sql.exec('set constraints all immediate')
      await rpc('app_save_place', [placeId, { name: 'Immediate caller', location, regionIds: [regionId], labelIds: [] }, false])
    })
    expect((await sql.query<{ allowed: boolean }>(`select has_function_privilege('anon','public.app_save_place(uuid,jsonb,boolean)','execute') as allowed`)).rows[0].allowed).toBe(false)
  })

  it('round-trips backup v3 and remaps place and marker endpoint references atomically', async () => {
    const { regionId, placeId, tripId } = await fixture(other)
    const mapId = crypto.randomUUID(), markerId = crypto.randomUUID()
    await asUser(other, async () => {
      await sql.query(`insert into public.route_maps(id,name,trip_id,transport,origin,destination) values($1,'Map',$2,'WALKING',$3,$4)`,
        [mapId, tripId, { kind: 'place', placeId }, { kind: 'route-map-place', routeMapPlaceId: markerId }])
      await sql.query(`insert into public.route_map_places(id,route_map_id,name,location) values($1,$2,'Marker',$3)`, [markerId, mapId, location])
    })
    const snapshot = await adapter(other).snapshot()
    const data = { regions: [], places: [], labels: [], trips: [], itineraryItems: [], routeMaps: [], routeMapPlaces: [] } as Record<string, object[]>
    for (const row of snapshot.records) if (row.record) data[row.entity].push(row.record)
    const backup = new BackupRepository().validateImport({ format: 'travel-planner-backup', version: 3, exportedAt: new Date().toISOString(), data })
    const preview = await asUser(other, () => rpc<{ token: string }>('app_backup_preview_replace', [backup]))
    await asUser(other, () => rpc('app_backup_apply_replace', [backup, preview.token]))
    const restored = await adapter(other).snapshot()
    const map = restored.records.find(row => row.entity === 'routeMaps' && row.record && 'name' in row.record && row.record.name === 'Map')?.record
    if (!map || !('origin' in map) || !('destination' in map)) throw new Error('Missing restored map')
    expect(map.origin?.kind).toBe('place')
    if (map.origin?.kind === 'place') expect(map.origin.placeId).not.toBe(placeId)
    if (map.destination?.kind === 'route-map-place') expect(map.destination.routeMapPlaceId).not.toBe(markerId)
    expect(restored.records.some(row => row.entity === 'regions' && row.id === regionId)).toBe(false)
    expect(restored.records.filter(row => row.entity === 'places').every(row => row.record && 'location' in row.record && row.record.location)).toBe(true)
  })

  it('preserves geo data through public publication/apply and shared editing/cancellation', async () => {
    const { tripId } = await fixture()
    const snapshot = await asUser(member, () => rpc<PublicSnapshot>('app_public_itinerary', ['source', { sourceTripId: tripId }]))
    const publicId = crypto.randomUUID()
    await asUser(member, () => rpc('app_public_itinerary', ['publish', {
      id: publicId, sourceTripId: tripId, operationId: crypto.randomUUID(), baseVersion: null, snapshot,
    }]))
    const copy = await asUser(other, () => rpc<{ id: string; regionId: string }>('app_public_itinerary', [
      'apply', { id: publicId, operationId: crypto.randomUUID() },
    ]))
    expect((await sql.query<{ map_provider: string }>('select map_provider from public.regions where id=$1', [copy.regionId])).rows[0].map_provider).toBe('osm')
    await asUser(member, () => rpc('app_shared_trip', ['enable', tripId, {}]))
    const rows = await asUser(member, () => rpc<SharedTripSnapshot[]>('app_shared_trip', ['snapshot', null, {}]))
    const shared = parseSharedTripSnapshot(rows.find(row => row.id === tripId))
    if (!shared.document) throw new Error('Missing shared document')
    expect(shared.document.places[0].location).toEqual(location)
    const after = await asUser(member, () => rpc<{ snapshot: SharedTripSnapshot }>('app_shared_trip', ['save', tripId, {
      operationId: crypto.randomUUID(), baseVersion: shared.version,
      places: shared.document!.places.map(place => ({ ...place, name: 'Shared geo edit' })), items: shared.document!.items,
    }]))
    await asUser(member, () => rpc('app_cancel_shared_trip', ['cancel', tripId, {
      operationId: crypto.randomUUID(), baseVersion: after.snapshot.version,
    }]))
    expect((await sql.query<{ location: unknown }>(`select p.location from public.places p join public.itinerary_items i on i.place_id=p.id
      where i.trip_id=$1`, [tripId])).rows[0].location).toEqual(location)
  })

  it('uses a stable account-scoped default region ID without sharing owners', async () => {
    const id = await accountOsmRegionId(member)
    expect(await accountOsmRegionId(member)).toBe(id)
    expect(await accountOsmRegionId(other)).not.toBe(id)
  })
})
