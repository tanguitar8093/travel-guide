import 'fake-indexeddb/auto'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { syncCloudAdapter } from './sync-cloud.adapter'
import { supabase } from './supabase.client'
import { activateHybridAccount, deactivateHybridAccount, getHybridStatus, requireHybridStore } from './hybrid.runtime'
import { setDatabaseMode, setSyncMode } from './runtime'
import { regions, labels, places, trips, itineraryItems, routeMaps, routeMapPlaces, prepareMapWorkspace } from './index'
import { SyncDatabase } from './sync.database'
import { placeController } from '../modules/place/place.controller'
import { setDatabaseModeRole } from './mode-access'
import { accountOsmRegionId } from '../geo/osm-coverage'

const sql = new PGlite()
const migrations = import.meta.glob<string>('../../supabase/migrations/*.sql', {
  eager: true, query: '?raw', import: 'default',
})
const uid = '33333333-3333-4333-8333-333333333333'
const account = { projectId: crypto.randomUUID(), userId: uid }

beforeAll(async () => {
  setDatabaseModeRole('admin')
  await sql.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
  `)
  for (const path of Object.keys(migrations).sort()) {
    if (path.endsWith('/20261020005000_public_default_privilege_convergence.sql')) {
      await sql.exec(`create role supabase_admin;
        alter default privileges for role supabase_admin in schema public grant all on tables to anon,authenticated;
        alter default privileges for role supabase_admin in schema public grant usage,select,update on sequences to anon,authenticated;
        alter default privileges for role supabase_admin in schema public grant execute on functions to anon,authenticated;`)
    }
    await sql.exec(migrations[path].replace('create extension if not exists pgcrypto;', ''))
  }
  expect((await sql.query(`select defaclobjtype from pg_default_acl
    where defaclrole='supabase_admin'::regrole and defaclnamespace='public'::regnamespace`)).rows).toHaveLength(3)
  expect((await sql.query(`select 1 from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
    where d.defaclrole='postgres'::regrole and d.defaclnamespace='public'::regnamespace
      and a.grantee in ('anon'::regrole,'authenticated'::regrole)`)).rows).toEqual([])
  await sql.exec(`insert into auth.users values ('${uid}', 'admin@example.com');
    update public.user_roles set role='admin' where user_id='${uid}';`)
}, 120000)

afterEach(async () => {
  setSyncMode('manual')
  setDatabaseMode('supabase')
  deactivateHybridAccount()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await new SyncDatabase(account).delete()
})

afterAll(async () => { setDatabaseModeRole(null); await sql.close() })

it('automatically persists an admin label, place and itinerary item in production through the real engine and SQL RPCs', async () => {
  const saved = new Map<string, string>()
  vi.stubGlobal('window', Object.assign(new EventTarget(), {
    setTimeout: (...args: Parameters<typeof setTimeout>) => globalThis.setTimeout(...args),
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(timer),
    localStorage: {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => { saved.set(key, value) },
    },
  }))
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }))
  vi.stubGlobal('navigator', { locks: {
    request: async (_name: string, _options: unknown, work: (lock: object) => Promise<void>) => work({}),
  } })
  vi.stubEnv('DEV', false)

  // Replace only the HTTP boundary: keep the adapter, engine, outbox and SQL real.
  vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
    data: { session: { user: { id: uid } } }, error: null,
  } as Awaited<ReturnType<typeof supabase.auth.getSession>>)
  const rpc = vi.spyOn(supabase, 'rpc').mockImplementation((async (name: string, args?: Record<string, unknown>) => {
    await sql.exec('begin; set local role authenticated;')
    await sql.query("select set_config('request.jwt.claim.sub', $1, true)", [uid])
    try {
      const parameters = name === 'app_sync_push' ? [args?.p_task]
        : name === 'app_sync_pull' ? [args?.p_cursor, args?.p_limit]
        : name === 'app_shared_trip' ? [args?.p_action, args?.p_trip_id, args?.p_payload] : []
      const placeholders = parameters.map((_, index) => `$${index + 1}`).join(',')
      const result = await sql.query<{ result: unknown }>(`select public.${name}(${placeholders}) as result`, parameters)
      await sql.exec('commit')
      return { data: result.rows[0].result, error: null }
    } catch (error) {
      await sql.exec('rollback')
      return { data: null, error: { message: String(error) } }
    }
  }) as unknown as typeof supabase.rpc)

  await activateHybridAccount(account, 'admin')
  setDatabaseMode('hybrid')
  setSyncMode('manual')
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  setSyncMode('auto')
  const regionId = await regions.create({ name: 'Kyoto', zoom: 12, googlePlaceId: 'kyoto' })
  const labelId = await labels.create({ name: 'Food', color: '#ff0000' })
  const placeId = await places.create({ name: 'Cafe', googlePlaceId: 'cafe', regionIds: [regionId], labelIds: [labelId] })
  const tripId = await trips.create({ name: 'Trip', regionId, startDate: '2026-10-17', endDate: '2026-10-18' })
  const itemId = await itineraryItems.create({
    tripId, placeId, date: '2026-10-17', order: 0,
    travelDurationMinutes: 25, travelDistanceMeters: 12300,
  })
  const store = requireHybridStore()
  const mapId = await routeMaps.create({ name: 'Trip map', tripId, transport: 'WALKING' })
  const markerId = await routeMapPlaces.create({ routeMapId: mapId, googlePlaceId: 'added-location' })
  expect(await store.listTasks()).toHaveLength(7)

  await vi.advanceTimersByTimeAsync(1999)
  expect(rpc).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  // Observe timer-driven execution, never call a captured/cancelled callback by hand.
  await vi.waitFor(async () => {
    expect(getHybridStatus().error).toBeUndefined()
    expect((await store.getSummary()).lastSyncedAt).toBeDefined()
    expect(await store.listTasks()).toEqual([])
  }, { timeout: 5000, interval: 10 })

  expect((await sql.query('select id, name, owner_uid from public.labels where id=$1', [labelId])).rows)
    .toEqual([{ id: labelId, name: 'Food', owner_uid: uid }])
  expect((await sql.query('select id, name from public.places where id=$1', [placeId])).rows)
    .toEqual([{ id: placeId, name: 'Cafe' }])
  expect((await sql.query('select place_id, label_id from public.place_labels where place_id=$1', [placeId])).rows)
    .toEqual([{ place_id: placeId, label_id: labelId }])
  expect((await sql.query('select id, trip_id, place_id from public.itinerary_items where id=$1', [itemId])).rows)
    .toEqual([{ id: itemId, trip_id: tripId, place_id: placeId }])
  expect((await sql.query('select travel_distance_meters::text as distance from public.itinerary_items where id=$1', [itemId])).rows)
    .toEqual([{ distance: '12300' }])
  expect((await syncCloudAdapter.snapshot()).records.find((row) => row.id === itemId)?.record)
    .toMatchObject({ travelDistanceMeters: 12300 })
  expect((await sql.query('select id,trip_id from public.route_maps where id=$1', [mapId])).rows)
    .toEqual([{ id: mapId, trip_id: tripId }])
  expect((await sql.query('select id,google_place_id from public.route_map_places where id=$1', [markerId])).rows)
    .toEqual([{ id: markerId, google_place_id: 'added-location' }])

  const beforePlaceUpdateSync = (await store.getSummary()).lastSyncedAt
  await places.update(placeId, { name: 'Updated cafe' })
  await vi.advanceTimersByTimeAsync(2000)
  await vi.waitFor(async () => {
    expect(await store.listTasks()).toEqual([])
    expect((await store.getSummary()).lastSyncedAt).not.toBe(beforePlaceUpdateSync)
  }, { timeout: 5000, interval: 10 })
  expect((await sql.query('select name from public.places where id=$1', [placeId])).rows)
    .toEqual([{ name: 'Updated cafe' }])

  const beforeBatchSetupSync = (await store.getSummary()).lastSyncedAt
  const targetLabelId = await labels.create({ name: 'Batch label', color: '#00ff00' })
  const secondPlaceId = await places.create({ name: 'Park', googlePlaceId: 'park', regionIds: [regionId], labelIds: [] })
  await vi.advanceTimersByTimeAsync(2000)
  await vi.waitFor(async () => {
    expect(await store.listTasks()).toEqual([])
    expect((await store.getSummary()).lastSyncedAt).not.toBe(beforeBatchSetupSync)
  }, { timeout: 5000, interval: 10 })
  rpc.mockClear()

  expect(await placeController.assignLabelMany([placeId, secondPlaceId, placeId], targetLabelId)).toEqual({
    succeededIds: [placeId, secondPlaceId], failures: [],
  })
  const batchTasks = await store.listTasks()
  expect(batchTasks).toHaveLength(2)
  expect(batchTasks.map((task) => task.operation)).toEqual(['places.addLabel', 'places.addLabel'])
  expect((await places.getById(placeId))?.labelIds).toEqual([labelId, targetLabelId])
  await vi.advanceTimersByTimeAsync(1999)
  expect(rpc).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  await vi.waitFor(async () => {
    expect(getHybridStatus().error).toBeUndefined()
    expect(await store.listTasks()).toEqual([])
  }, { timeout: 5000, interval: 10 })
  expect((await sql.query('select place_id from public.place_labels where label_id=$1 order by place_id', [targetLabelId])).rows)
    .toEqual([placeId, secondPlaceId].sort().map((id) => ({ place_id: id })))
  expect((await sql.query('select label_id from public.place_labels where place_id=$1 and label_id=$2', [placeId, labelId])).rows)
    .toEqual([{ label_id: labelId }])

  saved.set('travel-planner:map-provider', 'osm')
  await vi.waitFor(() => expect(getHybridStatus().syncing).toBe(false), { timeout: 5000, interval: 10 })
  rpc.mockClear()
  await prepareMapWorkspace()
  await prepareMapWorkspace()
  const osmRegionId = await accountOsmRegionId(uid)
  const location = {
    source: 'osm', kind: 'point', reference: { provider: 'osm', id: 'node/123' },
    coordinate: { latitude: 26.4, longitude: 127.9 },
  } as const
  const osmPlaceId = await places.create({ name: 'OSM local', location, regionIds: [osmRegionId], labelIds: [] })
  const osmMapId = await routeMaps.create({
    name: 'OSM map', transport: 'WALKING', origin: { kind: 'place', placeId: osmPlaceId },
  })
  const osmMarkerId = await routeMapPlaces.create({ routeMapId: osmMapId, name: 'OSM marker', location })
  await routeMaps.update(osmMapId, { destination: { kind: 'route-map-place', routeMapPlaceId: osmMarkerId } })
  expect((await places.getById(osmPlaceId))?.location).toEqual(location)
  expect(await store.listTasks()).toHaveLength(7)
  expect(rpc).not.toHaveBeenCalled()
  expect((await sql.query('select id from public.places where id=$1', [osmPlaceId])).rows).toEqual([])
  await vi.advanceTimersByTimeAsync(2000)
  await vi.waitFor(async () => {
    expect(getHybridStatus().error).toBeUndefined()
    expect(await store.listTasks()).toEqual([])
  }, { timeout: 5000, interval: 10 })
  expect((await sql.query<{ location: unknown }>('select location from public.places where id=$1', [osmPlaceId])).rows[0].location).toEqual(location)
  expect((await sql.query<{ origin: unknown; destination: unknown }>('select origin,destination from public.route_maps where id=$1', [osmMapId])).rows[0]).toEqual({
    origin: { kind: 'place', placeId: osmPlaceId }, destination: { kind: 'route-map-place', routeMapPlaceId: osmMarkerId },
  })

  // Reopen the same local account and verify its committed data survives.
  setSyncMode('manual')
  await activateHybridAccount(account, 'admin')
  expect((await places.list()).find((place) => place.id === placeId)).toMatchObject({ name: 'Updated cafe' })
  expect(new Set((await places.getById(placeId))?.labelIds)).toEqual(new Set([labelId, targetLabelId]))
  expect((await places.getById(secondPlaceId))?.labelIds).toEqual([targetLabelId])
  expect(await itineraryItems.findByTripId(tripId)).toEqual([expect.objectContaining({ id: itemId, placeId, travelDistanceMeters: 12300 })])
  expect((await places.getById(osmPlaceId))?.location).toEqual(location)
}, 20000)