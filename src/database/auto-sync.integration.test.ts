import 'fake-indexeddb/auto'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import baseline from '../../supabase/migrations/20261017153621_repository_baseline.sql?raw'
import migration from '../../supabase/migrations/20261017153641_local_first_sync.sql?raw'
import { supabase } from './supabase.client'
import { activateHybridAccount, deactivateHybridAccount, getHybridStatus, requireHybridStore } from './hybrid.runtime'
import { setDatabaseMode, setSyncMode } from './runtime'
import { regions, labels, places, trips, itineraryItems } from './index'
import { SyncDatabase } from './sync.database'
import { placeController } from '../modules/place/place.controller'

const sql = new PGlite()
const uid = '33333333-3333-4333-8333-333333333333'
const account = { projectId: crypto.randomUUID(), userId: uid }

beforeAll(async () => {
  await sql.exec(`
    create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
  `)
  await sql.exec(baseline.replace('create extension if not exists pgcrypto;', ''))
  await sql.exec(`insert into auth.users values ('${uid}', 'admin@example.com');
    update public.user_roles set role='admin' where user_id='${uid}';`)
  await sql.exec(migration)
}, 30000)

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

afterAll(async () => { await sql.close() })

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
  const rpc = vi.spyOn(supabase, 'rpc').mockImplementation((async (name: string, args?: Record<string, unknown>) => {
    await sql.exec('begin; set local role authenticated;')
    await sql.query("select set_config('request.jwt.claim.sub', $1, true)", [uid])
    try {
      const parameters = name === 'app_sync_push' ? [args?.p_task]
        : name === 'app_sync_pull' ? [args?.p_cursor, args?.p_limit] : []
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
  const itemId = await itineraryItems.create({ tripId, placeId, date: '2026-10-17', order: 0 })
  const store = requireHybridStore()
  expect(await store.listTasks()).toHaveLength(5)

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

  await places.update(placeId, { name: 'Updated cafe' })
  await vi.advanceTimersByTimeAsync(2000)
  await vi.waitFor(async () => { expect(await store.listTasks()).toEqual([]) }, { timeout: 5000, interval: 10 })
  expect((await sql.query('select name from public.places where id=$1', [placeId])).rows)
    .toEqual([{ name: 'Updated cafe' }])

  const targetLabelId = await labels.create({ name: 'Batch label', color: '#00ff00' })
  const secondPlaceId = await places.create({ name: 'Park', googlePlaceId: 'park', regionIds: [regionId], labelIds: [] })
  await vi.advanceTimersByTimeAsync(2000)
  await vi.waitFor(async () => { expect(await store.listTasks()).toEqual([]) }, { timeout: 5000, interval: 10 })
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

  // Reopen the same local account and verify its committed data survives.
  setSyncMode('manual')
  await activateHybridAccount(account, 'admin')
  expect((await places.list()).find((place) => place.id === placeId)).toMatchObject({ name: 'Updated cafe' })
  expect(new Set((await places.getById(placeId))?.labelIds)).toEqual(new Set([labelId, targetLabelId]))
  expect((await places.getById(secondPlaceId))?.labelIds).toEqual([targetLabelId])
  expect(await itineraryItems.findByTripId(tripId)).toEqual([expect.objectContaining({ id: itemId, placeId })])
}, 20000)