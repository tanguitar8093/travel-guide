import 'fake-indexeddb/auto'
import { liveQuery } from 'dexie'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import baseline from '../../supabase/migrations/20261017153621_repository_baseline.sql?raw'
import syncMigration from '../../supabase/migrations/20261017153641_local_first_sync.sql?raw'
import distanceMigration from '../../supabase/migrations/20261018220000_itinerary_travel_distance.sql?raw'
import routeMigration from '../../supabase/migrations/20261019010000_route_maps.sql?raw'
import collaborationMigration from '../../supabase/migrations/20261019060000_trip_collaboration.sql?raw'
import sharedMigration from '../../supabase/migrations/20261019080000_shared_trip_editing.sql?raw'
import maintenanceMigration from '../../supabase/migrations/20261019081000_shared_trip_maintenance.sql?raw'
import cancellationMigration from '../../supabase/migrations/20261019090000_cancel_trip_sharing.sql?raw'
import deletionMigration from '../../supabase/migrations/20261020000000_shared_trip_delete_order.sql?raw'
import shutdown from '../../supabase/rollback/20261019080000_shared_trip_editing.sql?raw'
import { LocalSyncStore } from './local-sync.store'
import { SharedTripLocal } from './shared-trip.local'
import { SyncDatabase } from './sync.database'
import { SyncAccountContext } from './sync-account-context'
import { syncHybridManually } from './sync-engine'
import type { CloudSyncPull, CloudSyncPush, CloudSyncSnapshot } from './sync-cloud.adapter'
import type { SharedTripDocument, SharedTripSaveResult, SharedTripSnapshot } from './shared-trip.types'
import type { SyncTask } from './sync.types'
import { SharedTripPermissionError } from './shared-trip.cloud'
import { prepareConflictReview, resolveConflictReview } from './sync-conflicts'

const sql = new PGlite()
const owner = '11111111-1111-4111-8111-111111111111'
const editor = '22222222-2222-4222-8222-222222222222'
const viewer = '33333333-3333-4333-8333-333333333333'
const basic = '44444444-4444-4444-8444-444444444444'
const databases: SyncDatabase[] = []
const lock = async (_name: string, work: () => Promise<void>) => work()
let originalSyncPush: string

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

async function rpc<T>(action: string, tripId: string | null = null, payload: unknown = {}): Promise<T> {
  const result = await sql.query<{ result: T }>('select public.app_shared_trip($1,$2,$3) as result', [action, tripId, payload])
  return result.rows[0].result
}

async function fixture() {
  const regionId = crypto.randomUUID()
  const tripId = crypto.randomUUID()
  const placeId = crypto.randomUUID()
  const itemId = crypto.randomUUID()
  await asUser(owner, async () => {
    await sql.query("insert into public.regions(id,name,google_place_id,zoom) values($1,'Kyoto','kyoto',12)", [regionId])
    await sql.query("insert into public.places(id,name,google_place_id,notes,owner_uid) values($1,'Cafe','cafe','private-note',$2)", [placeId, owner])
    await sql.query("insert into public.trips(id,region_id,name,start_date,end_date,owner_uid) values($1,$2,'Trip','2026-10-20','2026-10-21',$3)", [tripId, regionId, owner])
    await sql.query("insert into public.itinerary_items(id,trip_id,place_id,date,sort_order,note,owner_uid) values($1,$2,$3,'2026-10-20',0,'shared trip note',$4)", [itemId, tripId, placeId, owner])
  })
  return { tripId, regionId, placeId, itemId }
}

async function tripMap(tripId: string) {
  const mapId = crypto.randomUUID()
  const markerId = crypto.randomUUID()
  await asUser(owner, async () => {
    await sql.query("insert into public.route_maps(id,trip_id,name,transport) values($1,$2,'Trip map','WALKING')", [mapId, tripId])
    await sql.query("insert into public.route_map_places(id,route_map_id,google_place_id) values($1,$2,'extra-place')", [markerId, mapId])
  })
  return { mapId, markerId }
}

async function invite(tripId: string, uid: string, role: 'viewer' | 'editor') {
  const invited = await asUser(owner, async () => {
    const result = await sql.query<{ result: { invitationId: string } }>(
      'select public.app_trip_collaboration($1,$2,$3) as result',
      ['invite', tripId, { inviteeUserId: uid, role }],
    )
    return result.rows[0].result
  })
  await asUser(uid, () => sql.query('select public.app_trip_collaboration($1,$2,$3)', ['accept', tripId, { invitationId: invited.invitationId }]))
}

async function snapshot(uid: string, tripId: string): Promise<SharedTripSnapshot> {
  const rows = await asUser(uid, () => rpc<SharedTripSnapshot[]>('snapshot'))
  const result = rows.find((row) => row.id === tripId)
  if (!result) throw new Error('Missing test snapshot')
  return result
}

function doc(row: SharedTripSnapshot): SharedTripDocument {
  if (!row.document) throw new Error('Test trip is inaccessible')
  return row.document
}

function addItem(document: SharedTripDocument): SharedTripDocument {
  const placeId = crypto.randomUUID()
  return {
    ...document, places: [...document.places, { id: placeId, name: 'Park', googlePlaceId: 'park' }],
    items: [...document.items, { id: crypto.randomUUID(), placeId, date: '2026-10-20', order: 1, transport: 'WALKING' }],
  }
}

function save(uid: string, row: SharedTripSnapshot, document: SharedTripDocument, operationId: string = crypto.randomUUID()) {
  return asUser(uid, () => rpc<SharedTripSaveResult>('save', row.id, {
    operationId, baseVersion: row.version, places: document.places, items: document.items,
  }))
}

function cloud(uid: string) {
  return {
    snapshot: async () => asUser(uid, async () => (await sql.query<{ result: CloudSyncSnapshot }>('select public.app_sync_snapshot() as result')).rows[0].result),
    pull: async (cursor: string, limit = 100) => asUser(uid, async () =>
      (await sql.query<{ result: CloudSyncPull }>('select public.app_sync_pull($1,$2) as result', [cursor, limit])).rows[0].result),
    push: async (task: SyncTask) => asUser(uid, async () =>
      (await sql.query<{ result: CloudSyncPush }>('select public.app_sync_push($1) as result', [{
        protocolVersion: 1, account: task.account, operationId: task.operationId, changes: task.changes,
      }])).rows[0].result),
    shared: {
      list: () => asUser(uid, () => rpc<SharedTripSnapshot[]>('snapshot')),
      enable: async (tripId: string) => { await asUser(uid, () => rpc('enable', tripId)) },
      save: async (tripId: string, operationId: string, baseVersion: string, document: SharedTripDocument) => {
        try {
          return await asUser(uid, () => rpc<SharedTripSaveResult>('save', tripId, { operationId, baseVersion, places: document.places, items: document.items }))
        } catch (cause) {
          if (cause instanceof Error && cause.message.includes('editor access')) throw new SharedTripPermissionError(cause.message)
          throw cause
        }
      },
    },
  }
}

async function local(uid = editor) {
  const database = new SyncDatabase({ projectId: crypto.randomUUID(), userId: uid })
  databases.push(database)
  const context = new SyncAccountContext()
  context.activate(database.account)
  const store = new LocalSyncStore(database, context)
  await store.prepareLocal()
  return { database, context, store, local: new SharedTripLocal(store) }
}

beforeAll(async () => {
  await sql.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;`)
  await sql.exec(baseline.replace('create extension if not exists pgcrypto;', ''))
  await sql.exec(`insert into auth.users values('${owner}','owner@example.com'),('${editor}','editor@example.com'),
    ('${viewer}','viewer@example.com'),('${basic}','basic@example.com');
    update public.user_roles set role='member' where user_id in ('${owner}','${editor}','${viewer}');`)
  await sql.exec(syncMigration)
  await sql.exec(distanceMigration)
  await sql.exec(routeMigration)
  await sql.exec(collaborationMigration)
  await sql.exec(sharedMigration)
  await sql.exec(maintenanceMigration)
  await sql.exec(cancellationMigration)
  originalSyncPush = (await sql.query<{ definition: string }>(
    "select pg_get_functiondef('public.app_sync_push(jsonb)'::regprocedure) as definition",
  )).rows[0].definition
  await sql.exec(deletionMigration)
}, 120000)

afterEach(async () => {
  vi.restoreAllMocks()
  for (const database of databases.splice(0)) await database.delete()
})
afterAll(async () => { await sql.close() })

it('loads shared snapshots and tasks inside a read-only liveQuery subscription', async () => {
  const device = await local()
  const observed = new Promise<unknown[]>((resolve, reject) => {
    const subscription = liveQuery(async () => [await device.local.list(), await device.local.tasks()]).subscribe({
      next: (value) => { subscription.unsubscribe(); resolve(value) },
      error: (error: unknown) => { subscription.unsubscribe(); reject(error) },
    })
  })
  await expect(observed).resolves.toEqual([[], []])
})

it('returns cached shared itinerary content through liveQuery without opening a write transaction', async () => {
  const { tripId, itemId } = await fixture()
  await asUser(owner, () => rpc('enable', tripId))
  const shared = await snapshot(owner, tripId)
  const device = await local(owner)
  await device.local.download([shared])
  const observed = new Promise<SharedTripSnapshot[]>((resolve, reject) => {
    const subscription = liveQuery(() => device.local.list()).subscribe({
      next: (value) => { subscription.unsubscribe(); resolve(value) },
      error: (error: unknown) => { subscription.unsubscribe(); reject(error) },
    })
  })
  const result = await observed
  expect(result).toEqual([shared])
  expect(result[0].document?.items[0].id).toBe(itemId)
})

it('enables one trip without changing private rows and never resets shared edits on repeated enable', async () => {
  const ids = await fixture()
  const before = (await sql.query('select to_jsonb(i) as row from public.itinerary_items i where id=$1', [ids.itemId])).rows
  await asUser(owner, () => rpc('enable', ids.tripId))
  const initial = await snapshot(owner, ids.tripId)
  expect(doc(initial).places).toEqual([{ id: ids.placeId, name: 'Cafe', googlePlaceId: 'cafe' }])
  expect(doc(initial).items[0].note).toBe('shared trip note')
  expect(doc(initial).places[0]).not.toHaveProperty('notes')
  const next = await save(owner, initial, addItem(doc(initial)))
  expect(next.status).toBe('applied')
  await asUser(owner, () => rpc('enable', ids.tripId))
  expect(doc(await snapshot(owner, ids.tripId)).items).toHaveLength(2)
  expect((await sql.query('select to_jsonb(i) as row from public.itinerary_items i where id=$1', [ids.itemId])).rows).toEqual(before)
  await expect(asUser(owner, () => sql.query("update public.itinerary_items set note='lost' where id=$1", [ids.itemId]))).rejects.toThrow(/已啟用協作.*請使用共享行程/)
  await asUser(owner, () => sql.query('update public.itinerary_items set travel_duration_minutes=null,travel_distance_meters=null where id=$1', [ids.itemId]))
})

it('accepts an editor, shares their new item, rejects stale writes and handles reorder/delete', async () => {
  const { tripId } = await fixture()
  await invite(tripId, editor, 'editor')
  await asUser(owner, () => rpc('enable', tripId))
  const initial = await snapshot(editor, tripId)
  const added = await save(editor, initial, addItem(doc(initial)))
  expect(added.status).toBe('applied')
  expect(doc(await snapshot(owner, tripId)).items).toHaveLength(2)
  expect((await save(owner, { ...initial, document: doc(await snapshot(owner, tripId)) }, doc(initial))).status).toBe('conflict')
  const current = await snapshot(editor, tripId)
  const moved = doc(current).items.map((item) => ({ ...item, order: 1 - item.order, travelDurationMinutes: 30, travelDistanceMeters: 999 }))
  const reordered = await save(editor, current, { ...doc(current), items: moved })
  expect(doc(reordered.snapshot).items.every((item) => item.travelDurationMinutes === undefined)).toBe(true)
  const removed = await save(editor, reordered.snapshot, { ...doc(reordered.snapshot), items: doc(reordered.snapshot).items.slice(0, 1) })
  expect(doc(removed.snapshot).items).toHaveLength(1)
})

it('denies viewer/basic/anonymous writes, unauthorized activation and direct shared-table reads', async () => {
  const { tripId } = await fixture()
  await invite(tripId, viewer, 'viewer')
  await asUser(owner, () => rpc('enable', tripId))
  const initial = await snapshot(viewer, tripId)
  await expect(save(viewer, initial, doc(initial))).rejects.toThrow('editor access')
  await expect(asUser(editor, () => rpc('enable', tripId))).rejects.toThrow('editor access')
  await expect(asUser(basic, () => rpc('snapshot'))).rejects.toThrow('requires member or admin')
  await expect(asUser(viewer, () => sql.query('select * from public.trip_shared_workspaces'))).rejects.toThrow('permission denied')
  const permissions = await sql.query<{ allowed: boolean }>("select has_function_privilege('anon','public.app_shared_trip(text,uuid,jsonb)','execute') as allowed")
  expect(permissions.rows[0].allowed).toBe(false)
})

it('validates shared payload references, dates, duplicate order, private fields and receipt identity', async () => {
  const { tripId } = await fixture()
  await asUser(owner, () => rpc('enable', tripId))
  const initial = await snapshot(owner, tripId)
  const document = doc(initial)
  await expect(save(owner, initial, { ...document, items: [{ ...document.items[0], placeId: crypto.randomUUID() }] })).rejects.toThrow('Invalid shared itinerary')
  await expect(save(owner, initial, { ...document, items: [{ ...document.items[0], date: '2027-01-01' }] })).rejects.toThrow('Invalid shared itinerary')
  await expect(save(owner, initial, { ...document, items: [...document.items, { ...document.items[0], id: crypto.randomUUID() }] })).rejects.toThrow('Duplicate')
  await expect(asUser(owner, () => rpc('save', tripId, {
    operationId: crypto.randomUUID(), baseVersion: initial.version, places: [{ ...document.places[0], notes: 'private' }], items: document.items,
  }))).rejects.toThrow('Invalid shared place')
  const operationId = crypto.randomUUID()
  const next = addItem(document)
  const first = await save(owner, initial, next, operationId)
  expect(await save(owner, initial, next, operationId)).toEqual(first)
  await expect(save(owner, first.snapshot, document, operationId)).rejects.toThrow('reused')
})

it('queues offline shared edits atomically and synchronizes them through the real existing engine', async () => {
  const { tripId } = await fixture()
  await invite(tripId, editor, 'editor')
  await asUser(owner, () => rpc('enable', tripId))
  const device = await local()
  const adapter = cloud(editor)
  await syncHybridManually(device.store, adapter, lock)
  const initial = (await device.local.list()).find((row) => row.id === tripId)!
  await device.local.queue(initial, addItem(doc(initial)))
  expect((await device.store.getSummary()).pendingCount).toBe(1)
  expect(doc(await snapshot(owner, tripId)).items).toHaveLength(1)
  const queued = (await device.local.list()).find((row) => row.id === tripId)!
  const second = { ...doc(queued), items: doc(queued).items.map((item) => ({ ...item, note: 'offline note' })) }
  await device.local.queue(queued, second)
  expect((await device.store.listTasks())[1].sharedTrip?.predecessorOperationId).toBeDefined()
  await syncHybridManually(device.store, adapter, lock)
  expect(await device.store.listTasks()).toEqual([])
  expect(doc(await snapshot(owner, tripId)).items).toHaveLength(2)
  expect(doc(await snapshot(owner, tripId)).items.every((item) => item.note === 'offline note')).toBe(true)
  expect(await device.database.itineraryItems.count()).toBe(0)
})

it('keeps cache and queue atomic on outbox failure and rejects stale forms/account switches', async () => {
  const { tripId } = await fixture()
  await invite(tripId, editor, 'editor')
  await asUser(owner, () => rpc('enable', tripId))
  const device = await local()
  await syncHybridManually(device.store, cloud(editor), lock)
  const initial = (await device.local.list()).find((row) => row.id === tripId)!
  vi.spyOn(device.database.outbox, 'add').mockRejectedValueOnce(new Error('disk full'))
  await expect(device.local.queue(initial, addItem(doc(initial)))).rejects.toThrow('disk full')
  expect((await device.local.list()).find((row) => row.id === tripId)).toEqual(initial)
  await device.local.queue(initial, addItem(doc(initial)))
  await expect(device.local.queue(initial, doc(initial))).rejects.toThrow('已更新')
  device.context.deactivate()
  await expect(device.local.list()).rejects.toThrow()
})

it('purges revoked cache, keeps pending drafts and forbids replay after revocation', async () => {
  const { tripId } = await fixture()
  await invite(tripId, editor, 'editor')
  await asUser(owner, () => rpc('enable', tripId))
  const device = await local()
  await syncHybridManually(device.store, cloud(editor), lock)
  const initial = (await device.local.list()).find((row) => row.id === tripId)!
  await device.local.queue(initial, addItem(doc(initial)))
  await asUser(owner, () => sql.query('select public.app_trip_collaboration($1,$2,$3)', ['remove_member', tripId, { userId: editor }]))
  await syncHybridManually(device.store, cloud(editor), lock)
  expect((await device.local.list()).find((row) => row.id === tripId)?.document).toBeNull()
  const task = (await device.store.listTasks())[0]
  expect(task.status).toBe('conflict')
  expect(task.sharedTrip?.after.items).toHaveLength(2)
  const latest = await snapshot(editor, tripId)
  await expect(device.local.resolve(tripId, latest, latest, 'local')).rejects.toThrow('撤銷')
  await device.local.resolve(tripId, latest, latest, 'cloud')
  expect(await device.store.listTasks()).toEqual([])
  await expect(save(editor, initial, doc(initial))).rejects.toThrow('editor access')
})

it('retains personal sync behavior and preserves shared tasks during personal conflict resolution', async () => {
  const { tripId } = await fixture()
  await invite(tripId, editor, 'editor')
  await asUser(owner, () => rpc('enable', tripId))
  const device = await local()
  const adapter = cloud(editor)
  await syncHybridManually(device.store, adapter, lock)
  const id = await device.store.mutate('region.create', (repositories) =>
    repositories.regions.create({ name: 'Local', googlePlaceId: 'local', zoom: 12 }))
  await syncHybridManually(device.store, adapter, lock)
  await device.store.mutate('region.update', (repositories) => repositories.regions.update(id, { name: 'Draft' }))
  await asUser(editor, () => sql.query("update public.regions set name='Cloud' where id=$1", [id]))
  await expect(syncHybridManually(device.store, adapter, lock)).rejects.toThrow('衝突')
  const initial = (await device.local.list()).find((row) => row.id === tripId)!
  await device.local.queue(initial, addItem(doc(initial)))
  const review = await prepareConflictReview(device.store, adapter, lock)
  await resolveConflictReview(device.store, review.token, 'cloud', adapter, lock)
  const retained = await device.store.listTasks()
  expect(retained).toHaveLength(1)
  expect(retained[0].sharedTrip?.tripId).toBe(tripId)
  expect(await device.database.regions.get(id)).toMatchObject({ name: 'Cloud' })
  await syncHybridManually(device.store, adapter, lock)
  expect(await device.store.listTasks()).toEqual([])
})

it('shuts down shared API non-destructively while preserving original private owner CRUD', async () => {
  const { tripId } = await fixture()
  await asUser(owner, () => rpc('enable', tripId))
  const before = (await sql.query('select to_jsonb(w) as row from public.trip_shared_workspaces w where trip_id=$1', [tripId])).rows
  await sql.exec(shutdown)
  const privileges = await sql.query<{ allowed: boolean }>("select has_function_privilege('authenticated','public.app_shared_trip(text,uuid,jsonb)','execute') as allowed")
  expect(privileges.rows[0].allowed).toBe(false)
  expect((await sql.query('select to_jsonb(w) as row from public.trip_shared_workspaces w where trip_id=$1', [tripId])).rows).toEqual(before)
  const privateIds = await fixture()
  await asUser(owner, () => sql.query("update public.itinerary_items set note='still works' where id=$1", [privateIds.itemId]))
  await sql.exec('grant execute on function public.app_shared_trip(text,uuid,jsonb) to authenticated')
})

async function cancel(uid: string, row: SharedTripSnapshot, operationId = crypto.randomUUID()) {
  return asUser(uid, async () => (await sql.query<{ result: { cancelled: boolean } }>(
    'select public.app_cancel_shared_trip($1,$2,$3) as result',
    ['cancel', row.id, { operationId, baseVersion: row.version }],
  )).rows[0].result)
}

it('cancels sharing atomically, retains latest edits as private rows and allows fresh reactivation', async () => {
  const { tripId, placeId, itemId } = await fixture()
  await invite(tripId, editor, 'editor')
  await asUser(owner, () => rpc('enable', tripId))
  const initial = await snapshot(editor, tripId)
  const edited = addItem(doc(initial))
  edited.items[0].note = 'latest collaborative content'
  const saved = await save(editor, initial, edited)
  expect(saved.status).toBe('applied')
  const latest = await snapshot(owner, tripId)
  const op = crypto.randomUUID()
  expect(await cancel(owner, latest, op)).toEqual({ cancelled: true })
  expect(await cancel(owner, latest, op)).toEqual({ cancelled: true })
  const rows = await asUser(owner, () => sql.query<{ id: string; place_id: string; note: string }>(
    'select id,place_id,note from public.itinerary_items where trip_id=$1 order by sort_order', [tripId],
  ))
  expect(rows.rows).toHaveLength(2)
  expect(rows.rows[0]).toMatchObject({ id: itemId, place_id: placeId, note: 'latest collaborative content' })
  expect((await sql.query('select * from public.trip_members where trip_id=$1', [tripId])).rows).toEqual([])
  expect((await sql.query('select * from public.trip_invitations where trip_id=$1', [tripId])).rows).toEqual([])
  expect((await sql.query<{ edit_mode: string }>('select edit_mode from public.trips where id=$1', [tripId])).rows[0].edit_mode).toBe('private')
  expect((await snapshot(editor, tripId)).document).toBeNull()
  await expect(save(editor, initial, edited)).rejects.toThrow('editor access')
  await asUser(owner, () => sql.query("update public.itinerary_items set note='personal editing restored' where id=$1", [itemId]))
  await asUser(owner, () => rpc('enable', tripId))
  const enabledAgain = await snapshot(owner, tripId)
  expect(BigInt(enabledAgain.version)).toBeGreaterThan(BigInt(latest.version))
  expect(doc(enabledAgain).items).toHaveLength(2)
  expect(doc(enabledAgain).items[0].note).toBe('personal editing restored')
  expect((await snapshot(editor, tripId)).document).toBeNull()
})

it('does not overwrite private place definitions when shared place fields differ', async () => {
  const { tripId, placeId } = await fixture()
  await asUser(owner, () => rpc('enable', tripId))
  const initial = await snapshot(owner, tripId)
  const changed = { ...doc(initial), places: doc(initial).places.map((place) => ({ ...place, name: 'Collaborative name' })) }
  await save(owner, initial, changed)
  await cancel(owner, await snapshot(owner, tripId))
  const original = (await sql.query<{ name: string; notes: string }>('select name,notes from public.places where id=$1', [placeId])).rows[0]
  expect(original).toEqual({ name: 'Cafe', notes: 'private-note' })
  const restored = (await sql.query<{ name: string; notes: string; place_id: string }>(
    'select p.name,p.notes,i.place_id from public.itinerary_items i join public.places p on p.id=i.place_id where i.trip_id=$1', [tripId],
  )).rows[0]
  expect(restored.name).toBe('Collaborative name')
  expect(restored.notes).toBe('private-note')
  expect(restored.place_id).not.toBe(placeId)
})

it('rejects stale cancellation and non-owner requests without changing the shared document', async () => {
  const { tripId } = await fixture()
  await invite(tripId, editor, 'editor')
  await invite(tripId, viewer, 'viewer')
  await asUser(owner, () => rpc('enable', tripId))
  const initial = await snapshot(owner, tripId)
  await expect(cancel(editor, initial)).rejects.toThrow('Only owner')
  await expect(cancel(viewer, initial)).rejects.toThrow('Only owner')
  await expect(cancel(basic, initial)).rejects.toThrow()
  await save(editor, await snapshot(editor, tripId), addItem(doc(initial)))
  await expect(cancel(owner, initial)).rejects.toThrow('已更新')
  expect(doc(await snapshot(owner, tripId)).items).toHaveLength(2)
  expect(doc(await snapshot(editor, tripId)).trip.access).toBe('editor')
  await sql.exec('set role anon')
  try {
    await expect(sql.query('select public.app_cancel_shared_trip(null,null,null)')).rejects.toThrow()
  } finally {
    await sql.exec('reset role')
  }
})

it('downloads cancelled contents through personal hybrid sync and preserves revoked editor drafts', async () => {
  const { tripId } = await fixture()
  await invite(tripId, editor, 'editor')
  await asUser(owner, () => rpc('enable', tripId))
  const ownerDevice = await local(owner)
  const editorDevice = await local(editor)
  await syncHybridManually(ownerDevice.store, cloud(owner), lock)
  await syncHybridManually(editorDevice.store, cloud(editor), lock)
  const initial = await snapshot(owner, tripId)
  const editorInitial = (await editorDevice.local.list()).find((row) => row.id === tripId)!
  await editorDevice.local.queue(editorInitial, addItem(doc(editorInitial)))
  await save(owner, initial, addItem(doc(initial)))
  await cancel(owner, await snapshot(owner, tripId))
  await syncHybridManually(ownerDevice.store, cloud(owner), lock)
  expect(await ownerDevice.database.itineraryItems.where('tripId').equals(tripId).count()).toBe(2)
  expect((await ownerDevice.local.list()).find((row) => row.id === tripId)?.document).toBeNull()
  await syncHybridManually(editorDevice.store, cloud(editor), lock)
  expect((await editorDevice.local.list()).find((row) => row.id === tripId)?.document).toBeNull()
  const pending = (await editorDevice.store.listTasks())[0]
  expect(pending.status).toBe('conflict')
  expect(pending.sharedTrip?.after.items).toHaveLength(2)
})

it('repairs a frozen child-first trip deletion, survives a lost response and revokes editor access', async () => {
  const ids = await fixture()
  const linked = await tripMap(ids.tripId)
  const unrelated = await fixture()
  const unrelatedMap = await tripMap(unrelated.tripId)
  await invite(ids.tripId, editor, 'editor')
  await asUser(owner, () => rpc('enable', ids.tripId))
  const ownerDevice = await local(owner)
  const editorDevice = await local(editor)
  const adapter = cloud(owner)
  await syncHybridManually(ownerDevice.store, adapter, lock)
  await syncHybridManually(editorDevice.store, cloud(editor), lock)
  const editorInitial = (await editorDevice.local.list()).find((row) => row.id === ids.tripId)!
  await editorDevice.local.queue(editorInitial, addItem(doc(editorInitial)))
  await ownerDevice.store.mutate('trip.delete', (repositories) => repositories.trips.delete(ids.tripId))
  expect(await ownerDevice.database.trips.get(ids.tripId)).toBeUndefined()
  expect(await ownerDevice.database.itineraryItems.get(ids.itemId)).toBeUndefined()
  expect(await ownerDevice.database.routeMaps.get(linked.mapId)).toBeUndefined()
  expect(await ownerDevice.database.routeMapPlaces.get(linked.markerId)).toBeUndefined()
  const queued = (await ownerDevice.store.listTasks())[0]
  expect(queued.changes.map((change) => change.entity)).toEqual([
    'routeMapPlaces', 'routeMaps', 'itineraryItems', 'trips',
  ])
  await sql.exec(originalSyncPush)
  try {
    await expect(syncHybridManually(ownerDevice.store, adapter, lock)).rejects.toThrow(/已啟用協作.*請使用共享行程/)
    expect(doc(await snapshot(owner, ids.tripId)).items).toHaveLength(1)
    expect((await sql.query('select id from public.itinerary_items where id=$1', [ids.itemId])).rows).toHaveLength(1)
    expect((await sql.query('select id from public.route_maps where id=$1', [linked.mapId])).rows).toHaveLength(1)
    expect((await sql.query('select id from public.route_map_places where id=$1', [linked.markerId])).rows).toHaveLength(1)
  } finally {
    await sql.exec(deletionMigration)
  }
  const frozen = (await ownerDevice.store.listTasks())[0]
  expect(frozen.status).toBe('failed')
  expect(frozen.uploadChanges).toEqual(queued.changes)
  const push = vi.spyOn(adapter, 'push')
  push.mockImplementationOnce(async (task) => {
    await cloud(owner).push(task)
    throw new Error('Response lost after commit')
  })
  await expect(syncHybridManually(ownerDevice.store, adapter, lock)).rejects.toThrow('Response lost')
  expect((await ownerDevice.store.listTasks())[0].uploadChanges).toEqual(frozen.uploadChanges)
  const receipt = await sql.query<{ payload: { changes: SyncTask['changes'] }; result: CloudSyncPush }>(
    'select payload,result from sync_private.receipts where owner_uid=$1 and operation_id=$2',
    [owner, frozen.operationId],
  )
  expect(receipt.rows[0].payload.changes).toEqual(JSON.parse(JSON.stringify(frozen.uploadChanges)))
  expect(receipt.rows[0].result.status).toBe('applied')
  if (receipt.rows[0].result.status !== 'applied') throw new Error('Deletion did not commit')
  expect(receipt.rows[0].result.changes.filter((change) => change.record === null).map((change) => change.id).sort())
    .toEqual([ids.tripId, ids.itemId, linked.mapId, linked.markerId].sort())
  await syncHybridManually(ownerDevice.store, adapter, lock)
  expect(push).toHaveBeenCalledTimes(2)
  expect(push.mock.calls[1][0].operationId).toBe(frozen.operationId)
  expect(push.mock.calls[1][0].changes).toEqual(frozen.uploadChanges)
  expect(await ownerDevice.store.listTasks()).toEqual([])
  expect((await ownerDevice.local.list()).find((row) => row.id === ids.tripId)?.document).toBeNull()
  expect(await ownerDevice.database.trips.get(unrelated.tripId)).toBeDefined()
  expect(await ownerDevice.database.itineraryItems.get(unrelated.itemId)).toBeDefined()
  expect(await ownerDevice.database.routeMaps.get(unrelatedMap.mapId)).toBeDefined()
  expect(await ownerDevice.database.routeMapPlaces.get(unrelatedMap.markerId)).toBeDefined()
  expect(await ownerDevice.database.places.get(ids.placeId)).toMatchObject({ notes: 'private-note' })
  expect(await ownerDevice.database.regions.get(ids.regionId)).toBeDefined()
  for (const table of ['trips', 'itinerary_items', 'route_maps', 'route_map_places',
    'trip_shared_workspaces', 'trip_members', 'trip_invitations']) {
    const column = table === 'trips' ? 'id' : 'trip_id'
    const source = table === 'route_map_places'
      ? 'select id from public.route_map_places where route_map_id=$1'
      : `select ${column} from public.${table} where ${column}=$1`
    expect((await sql.query(source, [table === 'route_map_places' ? linked.mapId : ids.tripId])).rows).toEqual([])
  }
  expect((await snapshot(editor, ids.tripId)).document).toBeNull()
  await expect(save(editor, editorInitial, doc(editorInitial))).rejects.toThrow('unavailable')
  await syncHybridManually(editorDevice.store, cloud(editor), lock)
  expect((await editorDevice.local.list()).find((row) => row.id === ids.tripId)?.document).toBeNull()
  const draft = (await editorDevice.store.listTasks())[0]
  expect(draft.status).toBe('conflict')
  expect(draft.sharedTrip?.after.items).toHaveLength(2)
})

it('preserves direct cloud deletion of an active shared trip without deleting private places', async () => {
  const ids = await fixture()
  const linked = await tripMap(ids.tripId)
  await invite(ids.tripId, editor, 'editor')
  await asUser(owner, () => rpc('enable', ids.tripId))
  await asUser(owner, () => sql.query('delete from public.trips where id=$1', [ids.tripId]))
  expect((await snapshot(editor, ids.tripId)).document).toBeNull()
  expect((await sql.query('select id from public.itinerary_items where id=$1', [ids.itemId])).rows).toEqual([])
  expect((await sql.query('select id from public.route_maps where id=$1', [linked.mapId])).rows).toEqual([])
  expect((await sql.query('select id from public.route_map_places where id=$1', [linked.markerId])).rows).toEqual([])
  expect((await sql.query('select id from public.places where id=$1', [ids.placeId])).rows).toHaveLength(1)
})

it('keeps version and ownership checks ahead of trip cascade deletion', async () => {
  const ids = await fixture()
  await invite(ids.tripId, editor, 'editor')
  await asUser(owner, () => rpc('enable', ids.tripId))
  const device = await local(owner)
  await syncHybridManually(device.store, cloud(owner), lock)
  await device.store.mutate('trip.delete', (repositories) => repositories.trips.delete(ids.tripId))
  const task = await device.store.prepareUpload()
  if (!task) throw new Error('Missing deletion task')
  await expect(cloud(editor).push({ ...task, account: { ...task.account, userId: editor } })).rejects.toThrow('another account')
  await asUser(owner, () => sql.query("update public.trips set name='Changed before upload' where id=$1", [ids.tripId]))
  expect((await cloud(owner).push(task)).status).toBe('conflict')
  expect(doc(await snapshot(owner, ids.tripId)).trip.name).toBe('Changed before upload')
  expect((await sql.query('select id from public.itinerary_items where id=$1', [ids.itemId])).rows).toHaveLength(1)
  expect((await device.store.listTasks())[0].operationId).toBe(task.operationId)
})

it('skips pending successors of a conflicted shared trip but still stops at a private conflict', async () => {
  const { tripId } = await fixture()
  await invite(tripId, editor, 'editor')
  await asUser(owner, () => rpc('enable', tripId))
  const device = await local()
  await syncHybridManually(device.store, cloud(editor), lock)
  const initial = (await device.local.list()).find((row) => row.id === tripId)!
  await device.local.queue(initial, addItem(doc(initial)))
  const next = (await device.local.list()).find((row) => row.id === tripId)!
  await device.local.queue(next, {
    ...doc(next), items: doc(next).items.map((item) => ({ ...item, note: 'dependent draft' })),
  })
  const [first, successor] = await device.store.listTasks()
  await device.store.markUpload(first, 'conflict', 'Confirmed shared conflict')
  const id = await device.store.mutate('region.create', (repositories) =>
    repositories.regions.create({ name: 'Eligible private task', googlePlaceId: 'private', zoom: 12 }))
  const prepared = await device.store.prepareUpload()
  if (!prepared) throw new Error('Missing private task')
  expect(prepared.changes[0].id).toBe(id)
  expect((await device.store.listTasks()).find((task) => task.operationId === successor.operationId)).toEqual(successor)
  await device.store.markUpload(prepared, 'conflict', 'Private conflict')
  await expect(device.store.prepareUpload()).rejects.toThrow('有待處理的衝突')
})

it('isolates a downloaded shared conflict and its successors while syncing private edits and another shared trip', async () => {
  const blocked = await fixture()
  const healthy = await fixture()
  for (const { tripId } of [blocked, healthy]) {
    await invite(tripId, editor, 'editor')
    await asUser(owner, () => rpc('enable', tripId))
  }
  const device = await local()
  const adapter = cloud(editor)
  await syncHybridManually(device.store, adapter, lock)
  const lastCompleteSync = (await device.store.getSummary()).lastSyncedAt
  const initial = (await device.local.list()).find((row) => row.id === blocked.tripId)!
  await device.local.queue(initial, addItem(doc(initial)))
  const id = await device.store.mutate('region.create', (repositories) =>
    repositories.regions.create({ name: 'Private first', googlePlaceId: 'private-first', zoom: 12 }))
  const second = (await device.local.list()).find((row) => row.id === blocked.tripId)!
  await device.local.queue(second, {
    ...doc(second), items: doc(second).items.map((item) => ({ ...item, note: 'kept offline draft' })),
  })
  await device.store.mutate('region.update', (repositories) => repositories.regions.update(id, { name: 'Private latest' }))
  const other = (await device.local.list()).find((row) => row.id === healthy.tripId)!
  await device.local.queue(other, addItem(doc(other)))
  const before = (await device.local.tasks()).filter((task) => task.sharedTrip?.tripId === blocked.tripId)
  const remote = await snapshot(owner, blocked.tripId)
  await save(owner, remote, {
    ...doc(remote), items: doc(remote).items.map((item) => ({ ...item, note: 'owner change' })),
  })
  const sharedSave = vi.spyOn(adapter.shared, 'save')
  await syncHybridManually(device.store, adapter, lock)
  const retained = await device.store.listTasks()
  expect(retained.map((task) => task.operationId)).toEqual(before.map((task) => task.operationId))
  for (const [index, task] of retained.entries()) {
    expect(task.status).toBe('conflict')
    expect(task.sharedTrip?.after).toEqual(before[index].sharedTrip?.after)
    expect(task.sharedTrip?.baseVersion).toBe(before[index].sharedTrip?.baseVersion)
    expect(task.sharedTrip?.predecessorOperationId).toBe(before[index].sharedTrip?.predecessorOperationId)
    expect(task.attempts).toBe(0)
  }
  expect(sharedSave.mock.calls.map(([tripId]) => tripId)).toEqual([healthy.tripId])
  expect(doc(await snapshot(owner, healthy.tripId)).items).toHaveLength(2)
  expect(doc(await snapshot(owner, blocked.tripId)).items[0].note).toBe('owner change')
  expect((await sql.query('select name from public.regions where id=$1', [id])).rows).toEqual([{ name: 'Private latest' }])
  expect(await device.store.getSummary()).toMatchObject({
    conflictCount: 2, sharedConflictCount: 2, personalConflictCount: 0, failedCount: 0,
    lastSyncedAt: lastCompleteSync,
  })
  await device.store.mutate('region.update', (repositories) => repositories.regions.update(id, { name: 'Still syncing' }))
  await syncHybridManually(device.store, adapter, lock)
  expect((await sql.query('select name from public.regions where id=$1', [id])).rows).toEqual([{ name: 'Still syncing' }])
  expect(sharedSave).toHaveBeenCalledTimes(1)
  expect((await device.store.listTasks()).map((task) => task.operationId)).toEqual(before.map((task) => task.operationId))
})

it('continues private sync when a shared version conflict is first discovered by the upload response', async () => {
  const { tripId } = await fixture()
  await invite(tripId, editor, 'editor')
  await asUser(owner, () => rpc('enable', tripId))
  const device = await local()
  const adapter = cloud(editor)
  await syncHybridManually(device.store, adapter, lock)
  const initial = (await device.local.list()).find((row) => row.id === tripId)!
  await device.local.queue(initial, addItem(doc(initial)))
  const draft = (await device.store.listTasks())[0]
  const id = await device.store.mutate('region.create', (repositories) =>
    repositories.regions.create({ name: 'Private survives conflict', googlePlaceId: 'private', zoom: 12 }))
  const original = adapter.shared.save
  const sharedSave = vi.spyOn(adapter.shared, 'save').mockImplementationOnce(async (...args) => {
    const remote = await snapshot(owner, tripId)
    await save(owner, remote, addItem(doc(remote)))
    return original(...args)
  })
  await syncHybridManually(device.store, adapter, lock)
  const retained = await device.store.listTasks()
  expect(retained).toHaveLength(1)
  expect(retained[0]).toMatchObject({ operationId: draft.operationId, status: 'conflict', attempts: 1 })
  expect(retained[0].sharedTrip?.after).toEqual(draft.sharedTrip?.after)
  expect((await sql.query('select name from public.regions where id=$1', [id])).rows)
    .toEqual([{ name: 'Private survives conflict' }])
  expect(await device.store.getSummary()).toMatchObject({
    personalConflictCount: 0, sharedConflictCount: 1, failedCount: 0,
  })
  await syncHybridManually(device.store, adapter, lock)
  expect(sharedSave).toHaveBeenCalledTimes(1)
})

it('isolates revocation during upload, preserves the draft and still commits a private edit', async () => {
  const { tripId } = await fixture()
  await invite(tripId, editor, 'editor')
  await asUser(owner, () => rpc('enable', tripId))
  const device = await local()
  const adapter = cloud(editor)
  await syncHybridManually(device.store, adapter, lock)
  const initial = (await device.local.list()).find((row) => row.id === tripId)!
  await device.local.queue(initial, addItem(doc(initial)))
  const id = await device.store.mutate('region.create', (repositories) =>
    repositories.regions.create({ name: 'Private after revocation', googlePlaceId: 'private', zoom: 12 }))
  const original = adapter.shared.save
  vi.spyOn(adapter.shared, 'save').mockImplementationOnce(async (...args) => {
    await asUser(owner, () => sql.query('select public.app_trip_collaboration($1,$2,$3)',
      ['remove_member', tripId, { userId: editor }]))
    return original(...args)
  })
  await syncHybridManually(device.store, adapter, lock)
  expect((await device.local.list()).find((row) => row.id === tripId)?.document).toBeNull()
  const retained = await device.store.listTasks()
  expect(retained).toHaveLength(1)
  expect(retained[0].status).toBe('conflict')
  expect(retained[0].sharedTrip?.after.items).toHaveLength(2)
  expect(retained[0].sharedTrip?.conflict?.document).toBeNull()
  expect((await sql.query('select name from public.regions where id=$1', [id])).rows)
    .toEqual([{ name: 'Private after revocation' }])
  const latest = await snapshot(editor, tripId)
  await expect(device.local.resolve(tripId, latest, latest, 'local')).rejects.toThrow('撤銷')
})

it('retries an uncertain private request behind a shared conflict before downloading its committed event', async () => {
  const { tripId } = await fixture()
  await invite(tripId, editor, 'editor')
  await asUser(owner, () => rpc('enable', tripId))
  const device = await local()
  const adapter = cloud(editor)
  await syncHybridManually(device.store, adapter, lock)
  const initial = (await device.local.list()).find((row) => row.id === tripId)!
  await device.local.queue(initial, addItem(doc(initial)))
  const remote = await snapshot(owner, tripId)
  await save(owner, remote, addItem(doc(remote)))
  await device.local.download([await snapshot(editor, tripId)])
  const id = await device.store.mutate('region.create', (repositories) =>
    repositories.regions.create({ name: 'Private receipt', googlePlaceId: 'receipt', zoom: 12 }))
  const original = adapter.push
  const push = vi.spyOn(adapter, 'push').mockImplementationOnce(async (task) => {
    await original(task)
    throw new Error('Private response lost')
  })
  await expect(syncHybridManually(device.store, adapter, lock)).rejects.toThrow('Private response lost')
  const frozen = (await device.store.listTasks()).find((task) => !task.sharedTrip)!
  expect(frozen.status).toBe('failed')
  await syncHybridManually(device.store, adapter, lock)
  expect(push).toHaveBeenCalledTimes(2)
  expect(push.mock.calls[1][0].operationId).toBe(frozen.operationId)
  expect(push.mock.calls[1][0].changes).toEqual(frozen.uploadChanges)
  expect((await sql.query('select name from public.regions where id=$1', [id])).rows).toEqual([{ name: 'Private receipt' }])
  expect(await device.store.getSummary()).toMatchObject({
    personalConflictCount: 0, sharedConflictCount: 1, failedCount: 0,
  })
  expect(await device.store.listTasks()).toHaveLength(1)
})

it('does not skip an uncertain shared request or rewrite its frozen receipt payload', async () => {
  const { tripId } = await fixture()
  await invite(tripId, editor, 'editor')
  await asUser(owner, () => rpc('enable', tripId))
  const device = await local()
  const adapter = cloud(editor)
  await syncHybridManually(device.store, adapter, lock)
  const initial = (await device.local.list()).find((row) => row.id === tripId)!
  await device.local.queue(initial, addItem(doc(initial)))
  const id = await device.store.mutate('region.create', (repositories) =>
    repositories.regions.create({ name: 'Private after shared retry', googlePlaceId: 'private', zoom: 12 }))
  const original = adapter.shared.save
  const sharedSave = vi.spyOn(adapter.shared, 'save').mockImplementationOnce(async (...args) => {
    await original(...args)
    throw new Error('Shared response lost')
  })
  await expect(syncHybridManually(device.store, adapter, lock)).rejects.toThrow('Shared response lost')
  const frozen = (await device.store.listTasks())[0]
  expect(frozen.status).toBe('failed')
  expect(frozen.uploadChanges).toEqual([])
  expect((await sql.query('select id from public.regions where id=$1', [id])).rows).toEqual([])
  await syncHybridManually(device.store, adapter, lock)
  expect(sharedSave).toHaveBeenCalledTimes(2)
  expect(sharedSave.mock.calls[1]).toEqual(sharedSave.mock.calls[0])
  expect(doc(await snapshot(owner, tripId)).items).toHaveLength(2)
  expect(await device.store.listTasks()).toEqual([])
  expect((await sql.query('select name from public.regions where id=$1', [id])).rows)
    .toEqual([{ name: 'Private after shared retry' }])
})

it.each(['leave', 'remove_member', 'cancel'] as const)(
  'downloads %s revocation despite a private conflict, retains drafts and rejects the old invitation',
  async (action) => {
    const { tripId } = await fixture()
    await invite(tripId, editor, 'editor')
    const invitationId = (await sql.query<{ id: string }>(
      'select id from public.trip_invitations where trip_id=$1 and invitee_user_id=$2', [tripId, editor],
    )).rows[0].id
    await asUser(owner, () => rpc('enable', tripId))
    const device = await local()
    const adapter = cloud(editor)
    await syncHybridManually(device.store, adapter, lock)
    const id = await device.store.mutate('region.create', (repositories) =>
      repositories.regions.create({ name: 'Private base', googlePlaceId: 'private', zoom: 12 }))
    await syncHybridManually(device.store, adapter, lock)
    await device.store.mutate('region.update', (repositories) => repositories.regions.update(id, { name: 'Private draft' }))
    const initial = (await device.local.list()).find((row) => row.id === tripId)!
    await device.local.queue(initial, addItem(doc(initial)))
    await asUser(editor, () => sql.query("update public.regions set name='Private cloud' where id=$1", [id]))
    if (action === 'cancel') {
      const latest = await snapshot(owner, tripId)
      const operationId = crypto.randomUUID()
      await cancel(owner, latest, operationId)
      await cancel(owner, latest, operationId)
    } else {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await asUser(action === 'leave' ? editor : owner, () => sql.query(
          'select public.app_trip_collaboration($1,$2,$3)',
          [action, tripId, action === 'leave' ? {} : { userId: editor }],
        ))
      }
    }
    const sharedSave = vi.spyOn(adapter.shared, 'save')
    await expect(syncHybridManually(device.store, adapter, lock)).rejects.toThrow('衝突')
    expect(sharedSave).not.toHaveBeenCalled()
    expect((await device.local.list()).find((row) => row.id === tripId)?.document).toBeNull()
    expect(await device.store.getSummary()).toMatchObject({
      personalConflictCount: 1, sharedConflictCount: 1,
    })
    const task = (await device.local.tasks())[0]
    expect(task.sharedTrip?.after.items).toHaveLength(2)
    const revoked = task.sharedTrip!.conflict!
    await expect(device.local.resolve(tripId, revoked, revoked, 'local')).rejects.toThrow('撤銷')
    await expect(asUser(editor, () => sql.query(
      'select public.app_trip_collaboration($1,$2,$3)', ['accept', tripId, { invitationId }],
    ))).rejects.toThrow()
    await expect(save(editor, initial, doc(initial))).rejects.toThrow('editor access')
    await device.local.resolve(tripId, revoked, revoked, 'cloud')
    const retained = await device.store.listTasks()
    expect(retained).toHaveLength(1)
    expect(retained[0].sharedTrip).toBeUndefined()
    expect(retained[0].status).toBe('conflict')
    expect((await device.database.regions.get(id))?.name).toBe('Private draft')
  },
)

it('checks downgraded rights before replaying a committed receipt and requires explicit resolution after regrant', async () => {
  const { tripId } = await fixture()
  await invite(tripId, editor, 'editor')
  const invitationId = (await sql.query<{ id: string }>(
    'select id from public.trip_invitations where trip_id=$1 and invitee_user_id=$2', [tripId, editor],
  )).rows[0].id
  await asUser(owner, () => rpc('enable', tripId))
  const device = await local()
  const adapter = cloud(editor)
  await syncHybridManually(device.store, adapter, lock)
  const initial = (await device.local.list()).find((row) => row.id === tripId)!
  await device.local.queue(initial, addItem(doc(initial)))
  const original = adapter.shared.save
  const sharedSave = vi.spyOn(adapter.shared, 'save').mockImplementationOnce(async (...args) => {
    await original(...args)
    throw new Error('Committed response lost')
  })
  await expect(syncHybridManually(device.store, adapter, lock)).rejects.toThrow('Committed response lost')
  const frozen = (await device.store.listTasks())[0]
  await asUser(owner, () => sql.query('select public.app_trip_collaboration($1,$2,$3)',
    ['set_member', tripId, { userId: editor, role: 'viewer' }]))
  await syncHybridManually(device.store, adapter, lock)
  expect(sharedSave).toHaveBeenCalledTimes(2)
  expect(sharedSave.mock.calls[1]).toEqual(sharedSave.mock.calls[0])
  const retained = (await device.local.tasks())[0]
  expect(retained).toMatchObject({ operationId: frozen.operationId, status: 'conflict' })
  expect(retained.sharedTrip?.after).toEqual(frozen.sharedTrip?.after)
  expect(doc((await device.local.list()).find((row) => row.id === tripId)!).trip.access).toBe('viewer')
  const readOnly = retained.sharedTrip!.conflict!
  await expect(device.local.resolve(tripId, readOnly, readOnly, 'local')).rejects.toThrow('唯讀')
  await asUser(editor, () => sql.query('select public.app_trip_collaboration($1,$2,$3)',
    ['accept', tripId, { invitationId }]))
  expect(doc(await snapshot(editor, tripId)).trip.access).toBe('viewer')
  await expect(save(editor, initial, frozen.sharedTrip!.after, frozen.operationId)).rejects.toThrow('editor access')
  await asUser(owner, () => sql.query('select public.app_trip_collaboration($1,$2,$3)',
    ['set_member', tripId, { userId: editor, role: 'editor' }]))
  await syncHybridManually(device.store, adapter, lock)
  expect(sharedSave).toHaveBeenCalledTimes(2)
  const review = (await device.local.tasks())[0].sharedTrip!.conflict!
  expect(doc(review).trip.access).toBe('editor')
  await device.local.resolve(tripId, review, review, 'local')
  const replacement = (await device.local.tasks())[0]
  expect(replacement.operationId).not.toBe(frozen.operationId)
  expect(replacement.sharedTrip?.baseVersion).toBe(review.version)
  await syncHybridManually(device.store, adapter, lock)
  expect(await device.store.listTasks()).toEqual([])
  expect(doc(await snapshot(owner, tripId)).items).toHaveLength(2)
})

it('acknowledges an old cancellation receipt without cancelling a newly activated shared generation', async () => {
  const { tripId } = await fixture()
  await asUser(owner, () => rpc('enable', tripId))
  const before = await snapshot(owner, tripId)
  const operationId = crypto.randomUUID()
  await cancel(owner, before, operationId)
  await asUser(owner, () => rpc('enable', tripId))
  const reactivated = await snapshot(owner, tripId)
  expect(BigInt(reactivated.version)).toBeGreaterThan(BigInt(before.version))
  expect(await cancel(owner, before, operationId)).toEqual({ cancelled: true })
  expect(await snapshot(owner, tripId)).toEqual(reactivated)
  await expect(cancel(owner, reactivated, operationId)).rejects.toThrow('another payload')
  expect(await snapshot(owner, tripId)).toEqual(reactivated)
})
