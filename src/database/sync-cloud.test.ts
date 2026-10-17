import { PGlite } from '@electric-sql/pglite'
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import baseline from '../../supabase/migrations/20261017153621_repository_baseline.sql?raw'
import migration from '../../supabase/migrations/20261017153641_local_first_sync.sql?raw'
import 'fake-indexeddb/auto'
import { LocalSyncStore } from './local-sync.store'
import { SyncAccountContext } from './sync-account-context'
import { SyncDatabase } from './sync.database'
import { syncHybridManually } from './sync-engine'
import type { CloudSyncSnapshot, CloudSyncPull, CloudSyncPush } from './sync-cloud.adapter'

const db = new PGlite()
const member = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const admin = '33333333-3333-4333-8333-333333333333'
const basic = '44444444-4444-4444-8444-444444444444'
const regionId = '51111111-1111-4111-8111-111111111111'

async function asUser<Result>(uid: string, work: () => Promise<Result>): Promise<Result> {
  await db.exec('begin; set local role authenticated;')
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [uid])
  try {
    const result = await work()
    await db.exec('commit')
    return result
  } catch (error) {
    await db.exec('rollback')
    throw error
  }
}

async function rpc(name: string, args: unknown[] = []) {
  const parameters = args.map((_, index) => `$${index + 1}`).join(',')
  const result = await db.query<{ result: Record<string, unknown> }>(`select public.${name}(${parameters}) as result`, args)
  return result.rows[0].result
}

function task(changes: unknown[], operationId = crypto.randomUUID(), uid = member) {
  return { protocolVersion: 1, operationId, account: { userId: uid }, changes }
}

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
  `)
  await db.exec(baseline.replace('create extension if not exists pgcrypto;', ''))
  await db.exec(`insert into auth.users values ('${member}','member@example.com'),('${other}','other@example.com'),('${admin}','admin@example.com'),('${basic}','basic@example.com');
    update public.user_roles set role='member' where user_id in ('${member}','${other}');
    update public.user_roles set role='admin' where user_id='${admin}';`)
  await db.exec(migration)
}, 30000)

afterAll(async () => { await db.close() })

describe('cloud sync migration', () => {
  it('syncs real Dexie tasks through SQL RPCs and downloads complete relational cloud changes', async () => {
    const storage = new SyncDatabase({ projectId: crypto.randomUUID(), userId: other })
    const context = new SyncAccountContext()
    context.activate(storage.account)
    const store = new LocalSyncStore(storage, context)
    await store.prepareLocal()
    const adapter = {
      snapshot: async () => await asUser(other, () => rpc('app_sync_snapshot')) as unknown as CloudSyncSnapshot,
      pull: async (cursor: string) => await asUser(other, () => rpc('app_sync_pull', [cursor, 1])) as unknown as CloudSyncPull,
      push: async (pending: import('./sync.types').SyncTask) => await asUser(other, () => rpc('app_sync_push', [{
        protocolVersion: pending.protocolVersion, operationId: pending.operationId, account: pending.account, changes: pending.changes,
      }])) as unknown as CloudSyncPush,
    }
    try {
      const region = await store.mutate('region.create', (repositories) => repositories.regions.create({ name: 'Integration', zoom: 12, googlePlaceId: 'integration' }))
      const setup = await store.mutate('setup', async (repositories) => {
        const place = await repositories.places.create({ name: 'Cafe', googlePlaceId: 'cafe', regionIds: [region], labelIds: [] })
        const trip = await repositories.trips.create({ name: 'Trip', regionId: region, startDate: '2026-10-17', endDate: '2026-10-18' })
        const item = await repositories.itineraryItems.create({ tripId: trip, placeId: place, date: '2026-10-17', order: 0 })
        return { place, trip, item }
      })
      await syncHybridManually(store, adapter, async (_name, work) => { await work() })
      expect(await store.listTasks()).toEqual([])
      await asUser(other, () => db.query('update public.places set name=$1 where id=$2', ['Remote Cafe', setup.place]))
      await syncHybridManually(store, adapter, async (_name, work) => { await work() })
      expect(await storage.places.get(setup.place)).toMatchObject({ name: 'Remote Cafe', regionIds: [region] })
      await store.mutate('trip.delete', (repositories) => repositories.trips.delete(setup.trip))
      await syncHybridManually(store, adapter, async (_name, work) => { await work() })
      expect(await storage.itineraryItems.get(setup.item)).toBeUndefined()
      expect(await store.listTasks()).toEqual([])
      await asUser(other, () => db.query('delete from public.places where id=$1', [setup.place]))
      await asUser(other, () => db.query('delete from public.regions where id=$1', [region]))
      await syncHybridManually(store, adapter, async (_name, work) => { await work() })
      expect(await storage.regions.get(region)).toBeUndefined()
    } finally {
      await storage.delete()
    }
  })
  it('creates a clean baseline and preserves IDs with idempotent push', async () => {
    const payload = task([{ entity: 'regions', id: regionId, kind: 'put', baseVersion: null,
      after: { id: regionId, name: 'Kyoto', zoom: 12, googlePlaceId: 'kyoto' } }])
    const first = await asUser(member, () => rpc('app_sync_push', [payload]))
    expect(first.status).toBe('applied')
    const repeated = await asUser(member, () => rpc('app_sync_push', [payload]))
    expect(repeated).toEqual(first)
    expect((await db.query('select id from public.regions')).rows).toEqual([{ id: regionId }])
    await expect(asUser(member, () => rpc('app_sync_push', [{ ...payload, changes: [] }])))
      .rejects.toThrow()
  })

  it('returns own snapshot and hides other owners even from admin sync', async () => {
    expect((await asUser(member, () => rpc('app_sync_snapshot'))).records).toHaveLength(1)
    expect((await asUser(other, () => rpc('app_sync_snapshot'))).records).toEqual([])
    expect((await asUser(admin, () => rpc('app_sync_snapshot'))).records).toEqual([])
    await expect(asUser(basic, () => rpc('app_sync_snapshot'))).rejects.toThrow('member or admin')
  })

  it('detects stale versions and rejects another owner ID', async () => {
    const change = { entity: 'regions', id: regionId, kind: 'put', baseVersion: null,
      after: { id: regionId, name: 'Overwrite', zoom: 12, googlePlaceId: 'kyoto' } }
    expect((await asUser(member, () => rpc('app_sync_push', [task([change])]))).status).toBe('conflict')
    await expect(asUser(other, () => rpc('app_sync_push', [task([change], crypto.randomUUID(), other)])))
      .rejects.toThrow('another account')
  })

  it('tracks direct cloud updates and deletes with pull', async () => {
    const snapshot = await asUser(member, () => rpc('app_sync_snapshot'))
    await asUser(member, () => db.exec(`update public.regions set name='Direct update' where id='${regionId}'`))
    const updated = await asUser(member, () => rpc('app_sync_pull', [snapshot.cursor, 1]))
    expect(updated.changes).toHaveLength(1)
    await asUser(member, () => db.exec(`delete from public.regions where id='${regionId}'`))
    const deleted = await asUser(member, () => rpc('app_sync_pull', [updated.cursor, 1]))
    expect(deleted.changes).toEqual([expect.objectContaining({ id: regionId, record: null })])
  })

  it('rolls back valid earlier changes when a later record is invalid', async () => {
    const firstId = crypto.randomUUID()
    const secondId = crypto.randomUUID()
    const eventsBefore = (await db.query('select * from sync_private.events')).rows.length
    await expect(asUser(member, () => rpc('app_sync_push', [task([
      { entity: 'regions', id: firstId, kind: 'put', baseVersion: null, after: { id: firstId, name: 'Valid', zoom: 12, googlePlaceId: 'valid' } },
      { entity: 'regions', id: secondId, kind: 'put', baseVersion: null, after: { id: secondId, name: '', zoom: 12, googlePlaceId: 'invalid' } },
    ])]))).rejects.toThrow()
    expect((await db.query('select id from public.regions where id=$1', [firstId])).rows).toEqual([])
    expect((await db.query('select * from sync_private.events')).rows).toHaveLength(eventsBefore)
  })

  it('rejects owner and ACL fields and operation ID payload reuse', async () => {
    const id = crypto.randomUUID()
    const change = { entity: 'regions', id, kind: 'put', baseVersion: null, after: { id, name: 'Own', zoom: 12, googlePlaceId: 'own' } }
    await expect(asUser(member, () => rpc('app_sync_push', [task([{ ...change, after: { ...change.after, owner_uid: other } }])]))).rejects.toThrow('authorization fields')
    const payload = task([change])
    await asUser(member, () => rpc('app_sync_push', [payload]))
    await expect(asUser(member, () => rpc('app_sync_push', [{ ...payload, changes: [{ ...change, after: { ...change.after, name: 'Changed payload' } }] }]))).rejects.toThrow('different payload')
  })

  it('applies a connected batch with atomic place relations and complete transaction paging', async () => {
    const region = crypto.randomUUID(), label = crypto.randomUUID(), place = crypto.randomUUID(), trip = crypto.randomUUID()
    const firstItem = crypto.randomUUID(), secondItem = crypto.randomUUID()
    const records = [
      { entity: 'regions', after: { id: region, name: 'Connected', zoom: 12, googlePlaceId: 'connected' } },
      { entity: 'labels', after: { id: label, name: 'Food', color: '#fff' } },
      { entity: 'places', after: { id: place, name: 'Cafe', googlePlaceId: 'cafe', regionIds: [region], labelIds: [label] } },
      { entity: 'trips', after: { id: trip, name: 'Trip', regionId: region, startDate: '2026-10-17', endDate: '2026-10-18' } },
      { entity: 'itineraryItems', after: { id: firstItem, tripId: trip, placeId: place, date: '2026-10-17', order: 0 } },
      { entity: 'itineraryItems', after: { id: secondItem, tripId: trip, placeId: place, date: '2026-10-17', order: 1 } },
    ]
    const cursor = (await asUser(member, () => rpc('app_sync_snapshot'))).cursor
    const applied = await asUser(member, () => rpc('app_sync_push', [task(records.map((entry) => ({ ...entry, id: entry.after.id, kind: 'put', baseVersion: null })))]))
    expect(applied.status).toBe('applied')
    const pulled = await asUser(member, () => rpc('app_sync_pull', [cursor, 1]))
    const changes = pulled.changes as Array<{ id: string; record: unknown; version: string }>
    expect(changes.length).toBeGreaterThanOrEqual(6)
    expect(changes.filter((entry) => entry.id === place).at(-1)?.record).toMatchObject({ regionIds: [region], labelIds: [label] })
    const snapshot = await asUser(member, () => rpc('app_sync_snapshot'))
    const versions = snapshot.records as Array<{ id: string; version: string }>
    const reordered = records.slice(-2).map((entry, index) => ({
      ...entry, id: entry.after.id, kind: 'put', baseVersion: versions.find((record) => record.id === entry.after.id)!.version,
      after: { ...entry.after, order: 1 - index },
    }))
    expect((await asUser(member, () => rpc('app_sync_push', [task(reordered)]))).status).toBe('applied')
    const afterReorder = await asUser(member, () => rpc('app_sync_snapshot'))
    const tripVersion = (afterReorder.records as Array<{ id: string; version: string }>).find((entry) => entry.id === trip)!.version
    const deleted = await asUser(member, () => rpc('app_sync_push', [task([{ entity: 'trips', id: trip, kind: 'delete', baseVersion: tripVersion }])]))
    expect((deleted.changes as Array<{ record: unknown }>).filter((entry) => entry.record === null)).toHaveLength(3)
  })

  it('prevents cross-owner relations even when a privileged sync RPC writes', async () => {
    const foreignRegion = (await db.query<{ id: string }>('select id from public.regions where owner_uid=$1 limit 1', [member])).rows[0].id
    const place = crypto.randomUUID()
    await expect(asUser(other, () => rpc('app_sync_push', [task([
      { entity: 'places', id: place, kind: 'put', baseVersion: null, after: { id: place, name: 'Attack', googlePlaceId: 'attack', regionIds: [foreignRegion], labelIds: [] } },
    ], crypto.randomUUID(), other)]))).rejects.toThrow()
    expect((await db.query('select id from public.places where id=$1', [place])).rows).toEqual([])
  })

  it('denies anonymous RPCs and direct access to sync internals', async () => {
    await db.exec('begin; set local role anon;')
    try { await expect(rpc('app_sync_snapshot')).rejects.toThrow('permission denied') }
    finally { await db.exec('rollback') }
    await expect(asUser(member, () => db.query('select * from sync_private.receipts'))).rejects.toThrow('permission denied')
    await expect(asUser(member, () => rpc('app_sync_pull', ['999999', 1]))).rejects.toThrow('ahead')
  })

  it('does not advance a cursor over rolled-back changes and later commits remain visible', async () => {
    const before = await asUser(member, () => rpc('app_sync_snapshot'))
    await db.exec('begin;')
    await db.query('insert into public.regions(owner_uid,name,zoom,google_place_id) values($1,$2,12,$3)', [member, 'Rolled back', 'rollback'])
    await db.exec('rollback')
    const id = crypto.randomUUID()
    await asUser(member, () => rpc('app_sync_push', [task([{ entity: 'regions', id, kind: 'put', baseVersion: null, after: { id, name: 'Committed', zoom: 12, googlePlaceId: 'commit' } }])]))
    const result = await asUser(member, () => rpc('app_sync_pull', [before.cursor, 1]))
    expect(result.changes).toEqual([expect.objectContaining({ id })])
  })

  it('tracks existing backup clear and replacement RPCs without leaving stale snapshot records', async () => {
    const before = await asUser(member, () => rpc('app_sync_snapshot'))
    const preview = await asUser(member, () => rpc('app_backup_preview_clear'))
    await asUser(member, () => rpc('app_backup_apply_clear', [preview.token]))
    expect((await asUser(member, () => rpc('app_sync_snapshot'))).records).toEqual([])
    const pulled = await asUser(member, () => rpc('app_sync_pull', [before.cursor, 1]))
    expect((pulled.changes as Array<{ record: unknown }>).some((entry) => entry.record === null)).toBe(true)
    const backup = { format: 'travel-planner-backup', version: 1, exportedAt: new Date().toISOString(), data: {
      regions: [{ id: crypto.randomUUID(), name: 'Imported', zoom: 12, googlePlaceId: 'imported' }],
      places: [], labels: [], trips: [], itineraryItems: [],
    } }
    const replacement = await asUser(member, () => rpc('app_backup_preview_replace', [backup]))
    await asUser(member, () => rpc('app_backup_apply_replace', [backup, replacement.token]))
    expect((await asUser(member, () => rpc('app_sync_snapshot'))).records).toHaveLength(1)
    expect((await asUser(member, () => rpc('app_sync_pull', [pulled.cursor, 1]))).changes).toHaveLength(1)
  })
})
