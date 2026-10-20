import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import convergence from '../../supabase/migrations/20261020030000_deduplicate_updated_at_triggers.sql?raw'
import recovery from '../../supabase/rollback/20261020030000_deduplicate_updated_at_triggers.sql?raw'

// Isolated synthetic full chain only; no credentials, connections or private
// business data. Historical SQL below is exact catalog metadata from the
// before/after-install captures in convergence-live-install-qD4Kpw.
const migrations = import.meta.glob<string>('../../supabase/migrations/*.sql', {
  eager: true, query: '?raw', import: 'default',
})
const baseline = new PGlite()
let db: Awaited<ReturnType<PGlite['clone']>>
const tables = ['itinerary_items', 'labels', 'places', 'regions', 'trips']
const owner = '11111111-1111-4111-8111-111111111111'
const ids = {
  regions: '22222222-2222-4222-8222-222222222222',
  labels: '33333333-3333-4333-8333-333333333333',
  places: '44444444-4444-4444-8444-444444444444',
  trips: '55555555-5555-4555-8555-555555555555',
  itinerary_items: '66666666-6666-4666-8666-666666666666',
}
const historicalFunction = `CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$ begin new.updated_at:=now(); return new; end; $function$
`
const validationFunctions = `CREATE OR REPLACE FUNCTION public.prevent_trip_date_exclusion()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$ begin if exists(select 1 from public.itinerary_items item where item.trip_id=new.id and (item.date<new.start_date or item.date>new.end_date)) then raise exception 'Trip dates cannot exclude existing itinerary items.' using errcode='23514'; end if; return new; end; $function$;
CREATE OR REPLACE FUNCTION public.validate_itinerary_item_date()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$ declare trip_start date; trip_end date; begin select start_date,end_date into trip_start,trip_end from public.trips where id=new.trip_id; if not found then raise exception 'Trip does not exist.' using errcode='23503'; end if; if new.date<trip_start or new.date>trip_end then raise exception 'Itinerary item date must be within the trip dates.' using errcode='23514'; end if; return new; end; $function$;`

async function addHistory() {
  await db.exec(historicalFunction)
  for (const table of tables) {
    await db.exec(`CREATE TRIGGER ${table}_touch_updated_at BEFORE UPDATE ON public.${table}
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()`)
  }
  await db.exec(validationFunctions)
  await db.exec(`CREATE TRIGGER itinerary_items_validate_date BEFORE INSERT OR UPDATE ON public.itinerary_items
      FOR EACH ROW EXECUTE FUNCTION public.validate_itinerary_item_date();
    CREATE TRIGGER labels_prevent_cycle BEFORE INSERT OR UPDATE ON public.labels
      FOR EACH ROW EXECUTE FUNCTION public.prevent_label_cycle();
    CREATE TRIGGER trips_prevent_date_exclusion BEFORE UPDATE ON public.trips
      FOR EACH ROW EXECUTE FUNCTION public.prevent_trip_date_exclusion();`)
}

async function triggers() {
  return (await db.query<{ name: string; table_name: string; enabled: string; definition: string }>(`
    select t.tgname as name,c.relname as table_name,t.tgenabled as enabled,
      pg_get_triggerdef(t.oid,true) as definition
    from pg_trigger t join pg_class c on c.oid=t.tgrelid
    where c.relnamespace='public'::regnamespace and not t.tgisinternal order by c.relname,t.tgname`)).rows
}

async function protectedState() {
  const data = []
  const relations = (await db.query<{ name: string }>(`select relname as name from pg_class
    where relnamespace='public'::regnamespace and relkind='r' order by relname`)).rows
  for (const { name } of relations) {
    // Names come solely from this synthetic catalog; quote identifiers anyway.
    const quoted = name.replaceAll('"', '""')
    data.push({ name, rows: (await db.query(`select to_jsonb(r) as row from public."${quoted}" r
      order by to_jsonb(r)::text`)).rows })
  }
  return {
    data,
    functions: (await db.query(`select to_jsonb(p) as row from pg_proc p
      where pronamespace in ('public'::regnamespace,'sync_private'::regnamespace,
        'collaboration_private'::regnamespace) order by oid`)).rows,
    defaults: (await db.query('select to_jsonb(d) as row from pg_default_acl d order by oid')).rows,
    memberships: (await db.query('select to_jsonb(m) as row from pg_auth_members m order by roleid,member,grantor')).rows,
    tableSecurity: (await db.query(`select oid,relowner,relacl::text,relrowsecurity,relforcerowsecurity
      from pg_class where relnamespace='public'::regnamespace order by oid`)).rows,
    columns: (await db.query(`select to_jsonb(a) as row from pg_attribute a join pg_class c on c.oid=a.attrelid
      where c.relnamespace='public'::regnamespace order by a.attrelid,a.attnum`)).rows,
    constraints: (await db.query(`select to_jsonb(c) as row from pg_constraint c
      where connamespace='public'::regnamespace order by oid`)).rows,
    policies: (await db.query('select to_jsonb(p) as row from pg_policy p order by oid')).rows,
  }
}

async function blocked(sql = convergence, message = 'Timestamp convergence blocked:') {
  const before = await protectedState()
  const beforeTriggers = await triggers()
  await expect(db.exec(sql)).rejects.toThrow(message)
  await db.exec('rollback')
  expect(await protectedState()).toEqual(before)
  expect(await triggers()).toEqual(beforeTriggers)
}

beforeAll(async () => {
  await baseline.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;`)
  const paths = Object.keys(migrations).sort()
  expect(paths.filter(path => path.endsWith('/20261020030000_deduplicate_updated_at_triggers.sql'))).toHaveLength(1)
  for (const path of paths) {
    // PGlite provides gen_random_uuid natively, but does not bundle pgcrypto.
    await baseline.exec(migrations[path].replace('create extension if not exists pgcrypto;', ''))
  }
  // Retained platform defaults are injected after historical object creation.
  // This migration must leave raw entries, grant options and ACLs untouched.
  await baseline.exec(`create role supabase_admin;
    alter default privileges for role supabase_admin in schema public grant all on tables to postgres,service_role;
    alter default privileges for role supabase_admin in schema public grant all on sequences to postgres,service_role;
    alter default privileges for role supabase_admin in schema public grant execute on functions to postgres,service_role;
    insert into auth.users values ('${owner}','synthetic@example.test');
    update public.user_roles set role='member' where user_id='${owner}';
    begin; set local role authenticated;
    select set_config('request.jwt.claim.sub','${owner}',true);
    insert into public.regions(id,name,google_place_id,zoom) values('${ids.regions}','Region','region',12);
    insert into public.labels(id,name) values('${ids.labels}','Label');
    insert into public.places(id,name,google_place_id) values('${ids.places}','Place','place');
    insert into public.trips(id,region_id,name,start_date,end_date)
      values('${ids.trips}','${ids.regions}','Trip','2026-10-20','2026-10-22');
    insert into public.itinerary_items(id,trip_id,place_id,date,sort_order,note)
      values('${ids.itinerary_items}','${ids.trips}','${ids.places}','2026-10-20',0,'Keep note');
    commit;`)
}, 120000)

beforeEach(async () => { db = await baseline.clone() })
afterEach(async () => { await db.close() })
afterAll(async () => { await baseline.close() })

describe('exact five legacy updated_at trigger convergence', () => {
  it('is a no-op on the full clean chain without the historical function, repeatedly', async () => {
    expect((await db.query("select to_regprocedure('public.touch_updated_at()') as fn")).rows).toEqual([{ fn: null }])
    const before = await protectedState()
    const beforeTriggers = await triggers()
    await db.exec(convergence)
    await db.exec(convergence)
    expect(await protectedState()).toEqual(before)
    expect(await triggers()).toEqual(beforeTriggers)
  })

  it('removes exactly five, preserves the other three legacy validators and every function/default/data row', async () => {
    await addHistory()
    const before = await protectedState()
    const beforeTriggers = await triggers()
    const removed = beforeTriggers.filter(t => tables.some(table => t.name === `${table}_touch_updated_at`))
    expect(removed).toHaveLength(5)
    await db.exec(convergence)
    expect(await triggers()).toEqual(beforeTriggers.filter(t => !removed.includes(t)))
    expect(await protectedState()).toEqual(before)
    for (const name of ['itinerary_items_validate_date', 'labels_prevent_cycle', 'trips_prevent_date_exclusion']) {
      expect((await triggers()).some(t => t.name === name)).toBe(true)
    }
    const installed = await triggers()
    await db.exec(convergence)
    expect(await triggers()).toEqual(installed)
    expect(await protectedState()).toEqual(before)
  })

  it.each(['UTC', 'Pacific/Honolulu'])('keeps transaction now() semantics and all other row columns in %s', async (timezone) => {
    await addHistory()
    await db.exec(convergence)
    const catalog = await triggers()
    for (const table of tables) {
      const timestampTriggers = catalog.filter(t => t.table_name === table &&
        /EXECUTE FUNCTION (?:public\.)?(set_updated_at|touch_updated_at)\(\)$/.test(t.definition))
      // No counter wrapper: changing a guarded body would invalidate the proof.
      expect(timestampTriggers.map(t => [t.name, t.enabled])).toEqual([[`set_updated_at_${table}`, 'O']])
    }
    await db.exec(`begin; set local timezone='${timezone}'; set local role authenticated;`)
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [owner])
      for (const table of tables) {
        const id = ids[table as keyof typeof ids]
        const before = (await db.query<{ row: unknown }>(`select to_jsonb(r)-'updated_at' as row
          from public.${table} r where id=$1`, [id])).rows
        const result = await db.query<{ correct: boolean; changed: boolean }>(`with old as materialized (
            select updated_at from public.${table} where id=$1
          ), updated as (
            update public.${table} set updated_at='2000-01-01T00:00:00Z' where id=$1 returning updated_at
          ) select u.updated_at=now() as correct,u.updated_at<>o.updated_at as changed from updated u,old o`, [id])
        expect(result.rows).toEqual([{ correct: true, changed: true }])
        expect((await db.query(`select to_jsonb(r)-'updated_at' as row from public.${table} r where id=$1`, [id])).rows).toEqual(before)
      }
    } finally {
      await db.exec('rollback')
    }
  })

  it.each([
    ['legacy body whitespace', `create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path='' as $$ begin new.updated_at := now(); return new; end; $$`],
    ['replacement extra assignment', `create or replace function public.set_updated_at() returns trigger language plpgsql as $$begin new.name := 'changed'; new.updated_at = now(); return new; end;$$`],
    ['replacement clock semantics', `create or replace function public.set_updated_at() returns trigger language plpgsql as $$begin new.updated_at = clock_timestamp(); return new; end;$$`],
    ['function owner', 'alter function public.touch_updated_at() owner to service_role'],
    ['function config', "alter function public.touch_updated_at() set search_path='public'"],
    ['security definer', 'alter function public.set_updated_at() security definer'],
    ['function volatility', 'alter function public.set_updated_at() stable'],
    ['table owner', 'alter table public.regions owner to service_role'],
  ])('fails closed on %s without partial removal', async (_name, drift) => {
    await addHistory()
    await db.exec(drift)
    await blocked()
  })

  it.each([
    ['missing replacement', 'drop trigger set_updated_at_trips on public.trips'],
    ['disabled replacement', 'alter table public.trips disable trigger set_updated_at_trips'],
    ['replica replacement', 'alter table public.trips enable replica trigger set_updated_at_trips'],
    ['always legacy', 'alter table public.trips enable always trigger trips_touch_updated_at'],
    ['disabled legacy', 'alter table public.trips disable trigger trips_touch_updated_at'],
    ['partial inventory', 'drop trigger trips_touch_updated_at on public.trips'],
    ['replacement timing', `drop trigger set_updated_at_trips on public.trips;
      create trigger set_updated_at_trips after update on public.trips for each row execute function public.set_updated_at()`],
    ['legacy WHEN', `drop trigger trips_touch_updated_at on public.trips;
      create trigger trips_touch_updated_at before update on public.trips for each row when (new.name<>old.name) execute function public.touch_updated_at()`],
    ['legacy arguments', `drop trigger trips_touch_updated_at on public.trips;
      create trigger trips_touch_updated_at before update on public.trips for each row execute function public.touch_updated_at('unexpected')`],
    ['replacement column filter', `drop trigger set_updated_at_trips on public.trips;
      create trigger set_updated_at_trips before update of name on public.trips for each row execute function public.set_updated_at()`],
    ['replacement wrong function', `drop trigger set_updated_at_trips on public.trips;
      create trigger set_updated_at_trips before update on public.trips for each row execute function public.touch_updated_at()`],
    ['replacement statement timing', `drop trigger set_updated_at_trips on public.trips;
      create trigger set_updated_at_trips before update on public.trips for each statement execute function public.set_updated_at()`],
  ])('fails closed on %s, including late-table drift', async (_name, drift) => {
    await addHistory()
    await db.exec(drift)
    await blocked()
  })

  it('does not let zero legacy names hide a missing replacement', async () => {
    await db.exec('drop trigger set_updated_at_trips on public.trips')
    await blocked()
  })

  it('does not let zero legacy names hide changed surviving historical code', async () => {
    await db.exec(historicalFunction)
    await db.exec('alter function public.touch_updated_at() security definer')
    await blocked()
  })

  it('retains working cycle/date validation after removing the timestamp duplicates', async () => {
    await addHistory()
    await db.exec(convergence)
    await expect(db.query('update public.labels set parent_id=id where id=$1', [ids.labels])).rejects.toThrow('cycle')
    await expect(db.query("update public.itinerary_items set date='2026-10-23' where id=$1", [ids.itinerary_items])).rejects.toThrow('within the trip dates')
    // The repository range guard can fire before the historical date guard.
    await expect(db.query("update public.trips set start_date='2026-10-21' where id=$1", [ids.trips])).rejects.toThrow(/exclude (an )?existing itinerary item/)
  })

  it.each(['clean baseline', 'captured historical shape', 'drifted installed shape'])('blocks generic recovery for %s without inventing legacy history', async (shape) => {
    if (shape !== 'clean baseline') await addHistory()
    await db.exec(convergence)
    if (shape === 'drifted installed shape') {
      await db.exec('alter table public.trips disable trigger set_updated_at_trips')
    }
    await blocked(recovery, 'Timestamp recovery blocked:')
    expect((await triggers()).filter(t => tables.some(table => t.name === `${table}_touch_updated_at`))).toEqual([])
  })
})