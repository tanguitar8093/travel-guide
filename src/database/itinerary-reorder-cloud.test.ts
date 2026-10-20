import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import shutdown from '../../supabase/rollback/20261020020000_atomic_itinerary_reorder.sql?raw'

// Standalone synthetic database; never uses environment credentials or live DBs.
// Include permission convergence so the RPC is tested with the intended ACLs.
const migrations = import.meta.glob<string>('../../supabase/migrations/*.sql', {
  eager: true, query: '?raw', import: 'default',
})
const db = new PGlite()
const owner = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const admin = '33333333-3333-4333-8333-333333333333'
const basic = '44444444-4444-4444-8444-444444444444'
const day = '2026-10-20'

async function asUser<T>(uid: string | null, work: () => Promise<T>, role = 'authenticated'): Promise<T> {
  await db.exec(`begin; set local role ${role};`)
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [uid ?? ''])
    const result = await work()
    await db.exec('commit')
    return result
  } catch (error) {
    await db.exec('rollback')
    throw error
  }
}

function reorder(tripId: string | null, ids: Array<string | null> | null, date: string | null = day) {
  return db.query('select public.app_reorder_itinerary_items($1,$2::date,$3::uuid[])', [tripId, date, ids])
}

async function fixture(orders = [0, 1, 2, 3], uid = owner) {
  const tripId = crypto.randomUUID()
  const regionId = crypto.randomUUID()
  const places: string[] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
  const ids: string[] = orders.map(() => crypto.randomUUID())
  await asUser(uid, async () => {
    await db.query("insert into public.regions(id,name,google_place_id,zoom) values($1,'Synthetic region','region',12)", [regionId])
    for (const id of places) {
      await db.query("insert into public.places(id,name,google_place_id) values($1,'Synthetic place','place')", [id])
    }
    await db.query(`insert into public.trips(id,region_id,name,start_date,end_date)
      values($1,$2,'Synthetic trip','2026-10-20','2026-10-22')`, [tripId, regionId])
    for (const [index, id] of ids.entries()) {
      // Repeated places deliberately distinguish predecessor place from item ID.
      await db.query(`insert into public.itinerary_items
        (id,trip_id,place_id,date,sort_order,travel_duration_minutes,travel_distance_meters,note)
        values($1,$2,$3,$4,$5,$6,$7,'Keep note')`,
      [id, tripId, places[index % places.length], day, orders[index], 10 + index, 100 + index])
    }
  })
  return { tripId, ids, places }
}

async function rows(tripId: string) {
  return (await db.query<{
    id: string; sort_order: number; travel_duration_minutes: number | null; travel_distance_meters: string | null
  }>(`select id,sort_order,travel_duration_minutes,travel_distance_meters::text
    from public.itinerary_items where trip_id=$1 order by sort_order`, [tripId])).rows
}

async function state(tripId: string) {
  return {
    items: (await db.query('select to_jsonb(i) as row from public.itinerary_items i where trip_id=$1 order by id', [tripId])).rows,
    // Compare full contents, not only counts; sequence gaps on abort are normal.
    events: (await db.query('select to_jsonb(e) as row from sync_private.events e order by sequence')).rows,
    versions: (await db.query('select to_jsonb(v) as row from sync_private.versions v order by entity,id')).rows,
  }
}

beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;`)
  const paths = Object.keys(migrations).sort()
  expect(paths.some((path) => path.endsWith('/20261020020000_atomic_itinerary_reorder.sql'))).toBe(true)
  expect(paths.some((path) => path.endsWith('/20261020010000_privilege_convergence.sql'))).toBe(true)
  for (const path of paths) {
    if (path.endsWith('/20261020005000_public_default_privilege_convergence.sql')) {
      // Inject only AFTER historical object creation; retained platform defaults
      // must not contaminate existing RPC ACLs or require platform membership.
      await db.exec(`create role supabase_admin;
        alter default privileges for role supabase_admin in schema public grant all on tables to anon,authenticated;
        alter default privileges for role supabase_admin in schema public grant usage,select,update on sequences to anon,authenticated;
        alter default privileges for role supabase_admin in schema public grant execute on functions to anon,authenticated;`)
    }
    // PGlite has native gen_random_uuid but does not ship pgcrypto.
    await db.exec(migrations[path].replace('create extension if not exists pgcrypto;', ''))
  }
  await db.exec(`insert into auth.users values
    ('${owner}','owner@example.test'),('${other}','other@example.test'),
    ('${admin}','admin@example.test'),('${basic}','basic@example.test');
    update public.user_roles set role='member' where user_id in ('${owner}','${other}');
    update public.user_roles set role='admin' where user_id='${admin}';
    update public.user_roles set role='basic' where user_id='${basic}';`)
}, 120000)

afterAll(async () => { await db.close() })

describe('atomic private itinerary reorder on the current migration chain', () => {
  it('rejects unreviewed RPC grant options on reinstall without changing the retained platform matrix', async () => {
    const path = Object.keys(migrations).find(name => name.endsWith('/20261020020000_atomic_itinerary_reorder.sql'))!
    const platform = async () => (await db.query(`select to_jsonb(d) as row from pg_default_acl d
      where d.defaclrole='supabase_admin'::regrole order by oid`)).rows
    const before = await platform()
    await db.exec(`grant execute on function public.app_reorder_itinerary_items(uuid,date,uuid[])
      to authenticated with grant option`)
    try {
      await expect(db.exec(migrations[path])).rejects.toThrow('Atomic reorder blocked: unapproved RPC owner/ACL source')
      await db.exec('rollback')
      expect(await platform()).toEqual(before)
      expect((await db.query(`select a.is_grantable from pg_proc p
        cross join lateral aclexplode(p.proacl) a
        where p.oid='public.app_reorder_itinerary_items(uuid,date,uuid[])'::regprocedure
          and a.grantee='authenticated'::regrole`)).rows).toEqual([{ is_grantable: true }])
    } finally {
      await db.exec(`rollback; revoke grant option for execute on function
        public.app_reorder_itinerary_items(uuid,date,uuid[]) from authenticated`)
      await db.exec(migrations[path])
    }
  })

  it('preserves retained platform defaults and memberships on reorder reinstall', async () => {
    const snapshot = async () => ({
      defaults: (await db.query(`select to_jsonb(d) as row from pg_default_acl d
        where d.defaclrole='supabase_admin'::regrole order by oid`)).rows,
      memberships: (await db.query('select to_jsonb(m) as row from pg_auth_members m order by roleid,member,grantor')).rows,
    })
    const before = await snapshot()
    expect(before.defaults).toHaveLength(3)
    const path = Object.keys(migrations).find(name => name.endsWith('/20261020020000_atomic_itinerary_reorder.sql'))!
    await db.exec(migrations[path])
    expect(await snapshot()).toEqual(before)
  })

  it('also installs when the cloud RPC is absent, without replaying historical migrations', async () => {
    const path = Object.keys(migrations).find((name) => name.endsWith('/20261020020000_atomic_itinerary_reorder.sql'))
    if (!path) throw new Error('Missing atomic reorder migration')
    await db.exec('drop function public.app_reorder_itinerary_items(uuid,date,uuid[])')
    await db.exec(migrations[path])
    const f = await fixture([0, 1])
    await asUser(owner, () => reorder(f.tripId, [...f.ids].reverse()))
    expect((await rows(f.tripId)).map((row) => row.id)).toEqual([...f.ids].reverse())
  })

  it('uses the expected deferrable constraint and hardened authenticated-only RPC', async () => {
    const constraint = await db.query<{ condeferrable: boolean }>(`select condeferrable from pg_constraint
      where conrelid='public.itinerary_items'::regclass and conname='itinerary_items_trip_id_date_sort_order_key'`)
    expect(constraint.rows).toEqual([{ condeferrable: true }])
    const fn = await db.query<{ prosecdef: boolean; proconfig: string[] }>(`select prosecdef,proconfig from pg_proc
      where oid='public.app_reorder_itinerary_items(uuid,date,uuid[])'::regprocedure`)
    expect(fn.rows[0].prosecdef).toBe(true)
    expect(fn.rows[0].proconfig).toContain('search_path=""')
    for (const role of ['anon', 'authenticated']) {
      const result = await db.query<{ allowed: boolean }>(`select has_function_privilege($1,
        'public.app_reorder_itinerary_items(uuid,date,uuid[])','execute') as allowed`, [role])
      expect(result.rows[0].allowed).toBe(role === 'authenticated')
    }
    const publicAcl = await db.query(`select 1 from pg_proc p,
      lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid='public.app_reorder_itinerary_items(uuid,date,uuid[])'::regprocedure
        and a.grantee=0 and a.privilege_type='EXECUTE'`)
    expect(publicAcl.rows).toEqual([])
  })

  it('sorts the entire day, preserves other days/trips, and clears only changed predecessor places', async () => {
    const f = await fixture([4, 8, 12, 16, 20]) // places A B C A B
    const unrelated = await fixture()
    const untouched = await state(unrelated.tripId)
    const nextDayId = crypto.randomUUID()
    await asUser(owner, () => db.query(`insert into public.itinerary_items(id,trip_id,place_id,date,sort_order)
      values($1,$2,$3,'2026-10-21',7)`, [nextDayId, f.tripId, f.places[0]]))
    const nextDay = (await db.query('select to_jsonb(i) as row from public.itinerary_items i where id=$1', [nextDayId])).rows
    // A(item 3) B(item 4) C(item 2) A(item 0) B(item 1).
    // C and both Bs keep the same predecessor PLACE despite changed item IDs.
    const order = [f.ids[3], f.ids[4], f.ids[2], f.ids[0], f.ids[1]]
    await asUser(owner, () => reorder(f.tripId, order))
    const result = (await rows(f.tripId)).filter((row) => row.id !== nextDayId)
    expect(result.map((row) => [row.id, row.sort_order])).toEqual(order.map((id, index) => [id, index]))
    for (const row of result) {
      const index = f.ids.indexOf(row.id)
      const invalidated = index === 0 || index === 3
      expect(row.travel_duration_minutes).toBe(invalidated ? null : 10 + index)
      expect(row.travel_distance_meters).toBe(invalidated ? null : String(100 + index))
    }
    expect((await state(unrelated.tripId)).items).toEqual(untouched.items)
    expect((await db.query('select to_jsonb(i) as row from public.itinerary_items i where id=$1', [nextDayId])).rows).toEqual(nextDay)
    const events = (await db.query<{ id: string; record: { order: number }; transaction_id: string }>(`select id,record,transaction_id
      from sync_private.events where entity='itineraryItems' and id=any($1::uuid[]) order by sequence desc limit 5`, [f.ids])).rows
    expect(new Set(events.map((event) => event.transaction_id)).size).toBe(1)
    for (const event of events) expect(event.record.order).toBe(order.indexOf(event.id))
    const beforeNoop = await rows(f.tripId)
    await asUser(owner, () => reorder(f.tripId, order))
    expect(await rows(f.tripId)).toEqual(beforeNoop)
  })

  it('supports owner and admin across owners but denies cross-owner members, basic, anonymous and missing identity', async () => {
    const f = await fixture()
    const foreign = await fixture([0, 1], other)
    await asUser(other, () => reorder(foreign.tripId, [...foreign.ids].reverse()))
    for (const [uid, role] of [[other, 'authenticated'], [basic, 'authenticated'], [null, 'authenticated'], [null, 'anon']] as const) {
      const before = await state(f.tripId)
      await expect(asUser(uid, () => reorder(f.tripId, [...f.ids].reverse()), role)).rejects.toThrow()
      expect(await state(f.tripId)).toEqual(before)
    }
    await asUser(admin, () => reorder(f.tripId, [...f.ids].reverse()))
    expect((await rows(f.tripId)).map((row) => row.id)).toEqual([...f.ids].reverse())
    expect((await db.query<{ owner_uid: string }>('select owner_uid from public.itinerary_items where trip_id=$1', [f.tripId])).rows
      .every((row) => row.owner_uid === owner)).toBe(true)
  })

  it('rejects missing/duplicate/null/cross-day/cross-trip IDs and malformed array shapes without writes', async () => {
    const f = await fixture([0, 1])
    const foreign = await fixture([0], other)
    const nextDayId = crypto.randomUUID()
    await asUser(owner, () => db.query(`insert into public.itinerary_items(id,trip_id,place_id,date,sort_order)
      values($1,$2,$3,'2026-10-21',0)`, [nextDayId, f.tripId, f.places[0]]))
    const before = await state(f.tripId)
    for (const ids of [null, [], [f.ids[0]], [f.ids[0], f.ids[0]], [f.ids[0], null],
      [f.ids[0], crypto.randomUUID()], [f.ids[0], foreign.ids[0]], [f.ids[0], nextDayId], [...f.ids, crypto.randomUUID()]]) {
      await expect(asUser(owner, () => reorder(f.tripId, ids))).rejects.toThrow()
      expect(await state(f.tripId)).toEqual(before)
    }
    for (const array of [`{{${f.ids[0]},${f.ids[1]}}}`, `[0:1]={${f.ids.join(',')}}`]) {
      await expect(asUser(owner, () => db.query('select public.app_reorder_itinerary_items($1,$2,$3::uuid[])',
        [f.tripId, day, array]))).rejects.toThrow('Invalid reordered itinerary ID array')
      expect(await state(f.tripId)).toEqual(before)
    }
    await expect(asUser(owner, () => reorder(f.tripId, [f.ids[0], 'not-a-uuid']))).rejects.toThrow()
    expect(await state(f.tripId)).toEqual(before)
  })

  it('validates empty days, null/missing trips, null/invalid/out-of-range/infinite dates', async () => {
    const f = await fixture([])
    const before = await state(f.tripId)
    await asUser(owner, () => reorder(f.tripId, []))
    expect(await state(f.tripId)).toEqual(before)
    for (const date of [null, '2026-10-19', '2026-10-23', 'infinity', '-infinity', '2026-02-30', 'not-a-date']) {
      await expect(asUser(owner, () => reorder(f.tripId, [], date))).rejects.toThrow()
      expect(await state(f.tripId)).toEqual(before)
    }
    await expect(asUser(owner, () => reorder(f.tripId, null))).rejects.toThrow()
    for (const tripId of [null, crypto.randomUUID()]) {
      await expect(asUser(owner, () => reorder(tripId, []))).rejects.toThrow()
    }
    expect(await state(f.tripId)).toEqual(before)
  })

  it.each([false, true])('rejects active shared workspaces, including empty days (empty trip: %s)', async (empty) => {
    const f = await fixture(empty ? [] : [0, 1])
    await asUser(owner, () => db.query("select public.app_shared_trip('enable',$1,'{}'::jsonb)", [f.tripId]))
    const before = await state(f.tripId)
    const shared = (await db.query('select to_jsonb(w) as row from public.trip_shared_workspaces w where trip_id=$1', [f.tripId])).rows
    for (const uid of [owner, admin]) {
      for (const [date, ids] of [[day, f.ids], ['2026-10-21', []]] as const) {
        await expect(asUser(uid, () => reorder(f.tripId, [...ids], date))).rejects.toThrow('共同編輯')
        expect(await state(f.tripId)).toEqual(before)
      }
    }
    expect((await db.query('select to_jsonb(w) as row from public.trip_shared_workspaces w where trip_id=$1', [f.tripId])).rows).toEqual(shared)
  })

  it.each([
    { orders: [2, 3, 4] },
    { orders: [0, 2147483646, 2147483647] },
  ])('handles scratch collisions and maximum integer orders: $orders', async ({ orders }) => {
    const f = await fixture(orders)
    const order = [...f.ids].reverse()
    await asUser(owner, () => reorder(f.tripId, order))
    expect((await rows(f.tripId)).map((row) => [row.id, row.sort_order])).toEqual(order.map((id, index) => [id, index]))
  })

  it('rolls back first-phase rows AND sync events/versions after a forced second-phase failure', async () => {
    const f = await fixture([10, 20, 30])
    const before = await state(f.tripId)
    // AFTER ROW runs after sync_track_row by trigger name; failure must undo
    // both first-phase events and any already-written final-phase events.
    await db.exec(`create function public.reorder_test_fail() returns trigger language plpgsql as $$
      begin
        if new.trip_id='${f.tripId}'::uuid and new.sort_order < 3 then
          raise exception 'Forced final reorder failure';
        end if;
        return null;
      end; $$;
      create trigger z_reorder_test_fail after update on public.itinerary_items
        for each row execute function public.reorder_test_fail();`)
    try {
      await expect(asUser(owner, () => reorder(f.tripId, [...f.ids].reverse()))).rejects.toThrow('Forced final reorder failure')
      expect(await state(f.tripId)).toEqual(before)
    } finally {
      await db.exec('drop trigger z_reorder_test_fail on public.itinerary_items; drop function public.reorder_test_fail();')
    }
    await asUser(owner, () => reorder(f.tripId, [...f.ids].reverse()))
    expect((await rows(f.tripId)).map((row) => row.id)).toEqual([...f.ids].reverse())
  })

  it('fails closed without changing rows when the unique constraint is not deferrable', async () => {
    const f = await fixture([0, 1])
    const before = await state(f.tripId)
    await db.exec('begin')
    try {
      await db.exec(`alter table public.itinerary_items drop constraint itinerary_items_trip_id_date_sort_order_key;
        alter table public.itinerary_items add constraint itinerary_items_trip_id_date_sort_order_key unique(trip_id,date,sort_order);
        set local role authenticated;`)
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [owner])
      await expect(reorder(f.tripId, [...f.ids].reverse())).rejects.toThrow('deferrable itinerary order constraint')
    } finally {
      await db.exec('rollback')
    }
    expect(await state(f.tripId)).toEqual(before)
  })

  it('shutdown revokes only the new RPC, preserving data and existing APIs', async () => {
    const f = await fixture([0, 1])
    const before = await state(f.tripId)
    const syncBefore = (await asUser(owner, () => db.query('select public.app_sync_snapshot() as snapshot'))).rows
    await db.exec(shutdown)
    try {
      await expect(asUser(owner, () => reorder(f.tripId, f.ids))).rejects.toThrow('permission denied')
      expect(await state(f.tripId)).toEqual(before)
      expect((await asUser(owner, () => db.query('select public.app_sync_snapshot() as snapshot'))).rows).toEqual(syncBefore)
      await asUser(owner, () => db.query("update public.itinerary_items set note='Old direct API retained' where id=$1", [f.ids[0]]))
    } finally {
      await db.exec('grant execute on function public.app_reorder_itinerary_items(uuid,date,uuid[]) to authenticated')
    }
  })
})