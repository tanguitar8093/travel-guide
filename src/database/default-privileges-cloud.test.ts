import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import repair from '../../supabase/migrations/20261020005000_public_default_privilege_convergence.sql?raw'
import recovery from '../../supabase/rollback/20261020005000_public_default_privilege_convergence.sql?raw'

// Isolated catalog fixtures only. Roles are created by tests, NEVER migration.
const db = new PGlite()
let supportsMaintain = false
let version = 0

async function defaults() {
  return (await db.query('select to_jsonb(d) as row from pg_default_acl d order by oid')).rows
}

async function protectedState() {
  return {
    platform: (await db.query(`select to_jsonb(d) as row from pg_default_acl d
      where d.defaclrole=to_regrole('supabase_admin') order by oid`)).rows,
    defaults: (await db.query(`select d.defaclrole,d.defaclnamespace,d.defaclobjtype,a.*
      from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
      where a.grantee not in ('anon'::regrole,'authenticated'::regrole)
      order by d.defaclrole,d.defaclnamespace,d.defaclobjtype,a.grantor,a.grantee,a.privilege_type`)).rows,
    outside: (await db.query(`select to_jsonb(d) as row from pg_default_acl d
      where d.defaclnamespace <> 'public'::regnamespace order by oid`)).rows,
    objects: (await db.query(`select oid,relowner,relacl::text from pg_class
      where relnamespace in ('public'::regnamespace,'other_acl'::regnamespace) order by oid`)).rows,
    functions: (await db.query(`select oid,proowner,proacl::text from pg_proc
      where pronamespace in ('public'::regnamespace,'other_acl'::regnamespace) order by oid`)).rows,
    columns: (await db.query(`select attrelid,attnum,attacl::text from pg_attribute
      where attacl is not null order by attrelid,attnum`)).rows,
    schemas: (await db.query('select oid,nspowner,nspacl::text from pg_namespace order by oid')).rows,
    roles: (await db.query('select to_jsonb(r) as row from pg_roles r order by oid')).rows,
    memberships: (await db.query('select to_jsonb(m) as row from pg_auth_members m order by roleid,member,grantor')).rows,
    data: (await db.query('select * from public.existing_acl_probe order by id')).rows,
  }
}

async function drift(creators = ['postgres', 'supabase_admin']) {
  for (const creator of creators) {
    await db.exec(`alter default privileges for role ${creator} in schema public
        grant select,insert,update,delete,truncate,references,trigger on tables to anon,authenticated;
      alter default privileges for role ${creator} in schema public
        grant usage,select,update on sequences to anon,authenticated;
      alter default privileges for role ${creator} in schema public
        grant execute on functions to anon,authenticated;`)
    if (supportsMaintain) await db.exec(`alter default privileges for role ${creator} in schema public grant maintain on tables to anon,authenticated`)
    if (creator === 'supabase_admin') await db.exec(`
      alter default privileges for role supabase_admin in schema public grant all on tables to postgres,service_role;
      alter default privileges for role supabase_admin in schema public grant all on sequences to postgres,service_role;
      alter default privileges for role supabase_admin in schema public grant execute on functions to postgres,service_role;`)
  }
}

async function expectNoClientDefaults() {
  expect((await db.query(`select d.oid,a.* from pg_default_acl d
    left join pg_namespace n on n.oid=d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) a
    where (d.defaclnamespace=0 or n.nspname='public') and
      d.defaclrole is distinct from to_regrole('supabase_admin') and
      (a.grantee=0 or exists (select 1 from pg_roles r
        where r.rolname in ('anon','authenticated') and pg_has_role(r.oid,a.grantee,'MEMBER')))`)).rows).toEqual([])
}

beforeAll(async () => {
  version = Number((await db.query<{ version: string }>(
    "select current_setting('server_version_num') as version")).rows[0].version)
  supportsMaintain = version >= 170000
  // PGlite's bootstrap already owns postgres; do not CREATE it again.
  expect((await db.query<{ present: boolean }>("select to_regrole('postgres') is not null as present")).rows[0].present).toBe(true)
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create role acl_parent; create role default_creator; create role acl_operator;
    create schema other_acl;
    create table public.existing_acl_probe(id integer,value text);
    insert into public.existing_acl_probe values(1,'preserve');
    create sequence public.existing_sequence;
    create function public.existing_function() returns integer language sql as 'select 1';
    grant select(value) on public.existing_acl_probe to anon;
    grant select on public.existing_acl_probe to acl_operator;
    grant all on public.existing_acl_probe to service_role with grant option;
    grant execute on function public.existing_function() to service_role with grant option;
    grant usage on schema other_acl to anon;
    alter default privileges for role postgres in schema other_acl grant all on tables to anon,authenticated;
    alter default privileges for role postgres grant select on tables to service_role;
    alter default privileges for role postgres in schema public grant all on tables to service_role with grant option;
    alter default privileges for role postgres in schema public grant usage on sequences to service_role;
    alter default privileges for role postgres in schema public grant execute on functions to service_role;`)
}, 30000)

afterAll(async () => { await db.close() })

describe('approved public default ACL convergence', () => {
  it('accepts a clean standalone baseline with no supabase_admin and creates no roles', async () => {
    expect((await db.query<{ role: string | null }>("select to_regrole('supabase_admin')::text as role")).rows[0].role).toBeNull()
    const before = await defaults(), protectedBefore = await protectedState()
    await db.exec(repair)
    expect(await defaults()).toEqual(before)
    expect(await protectedState()).toEqual(protectedBefore)
    await db.exec('create role supabase_admin; grant usage,create on schema public to supabase_admin')
    const empty = await defaults()
    await db.exec(repair)
    expect(await defaults()).toEqual(empty)
  })

  it('clears only postgres and preserves the complete platform raw matrix and unrelated catalog', async () => {
    await drift()
    const rows = (await db.query<{ creator: string; grantor: string; grantee: string; is_grantable: boolean; privilege_type: string }>(`
      select d.defaclrole::regrole::text as creator,a.grantor::regrole::text as grantor,
        a.grantee::regrole::text as grantee,a.is_grantable,a.privilege_type
      from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
      where d.defaclnamespace='public'::regnamespace
        and a.grantee in ('anon'::regrole,'authenticated'::regrole)`)).rows
    expect(rows).toHaveLength(2 * 2 * (7 + (supportsMaintain ? 1 : 0) + 3 + 1))
    for (const row of rows) {
      expect(row.grantor).toBe(row.creator)
      expect(row.is_grantable).toBe(false)
    }
    expect(rows.some((row) => row.privilege_type === 'MAINTAIN')).toBe(supportsMaintain)
    const before = await protectedState()
    await db.exec(repair)
    await expectNoClientDefaults()
    expect(await protectedState()).toEqual(before)
    const clean = await defaults()
    await db.exec(repair)
    expect(await defaults()).toEqual(clean)
    expect(await protectedState()).toEqual(before)
  })

  it('accepts sparse approved drift without inventing absent grants', async () => {
    await db.exec('alter default privileges for role postgres in schema public grant update on sequences to authenticated')
    const before = await protectedState()
    await db.exec(repair)
    await expectNoClientDefaults()
    expect(await protectedState()).toEqual(before)
  })

  it('postgres objects lose client defaults; platform objects retain them and require per-object review', async () => {
    for (const creator of ['postgres', 'supabase_admin']) {
      const prefix = `default_probe_${creator}`
      try {
        await db.exec(`begin; set local role ${creator};
          create table public.${prefix}(id integer);
          create sequence public.${prefix}_seq;
          create function public.${prefix}_fn() returns integer language sql as 'select 1';
          commit;`)
        const relationCells = (await db.query(`select a.* from pg_class c cross join lateral
          aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S' then 's'::"char" else 'r'::"char" end,c.relowner))) a
          where c.oid in ('public.${prefix}'::regclass,'public.${prefix}_seq'::regclass)
            and a.grantee in ('anon'::regrole,'authenticated'::regrole)`)).rows
        expect(relationCells).toHaveLength(creator === 'postgres' ? 0 : 2 * (7 + (supportsMaintain ? 1 : 0) + 3))
        const functionCells = (await db.query(`select a.* from pg_proc p cross join lateral
          aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          where p.oid='public.${prefix}_fn()'::regprocedure
            and a.grantee in ('anon'::regrole,'authenticated'::regrole)`)).rows
        expect(functionCells).toHaveLength(creator === 'postgres' ? 0 : 2)
        expect((await db.query<{ privilege_type: string; is_grantable: boolean }>(`select a.privilege_type,a.is_grantable
          from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          where p.oid='public.${prefix}_fn()'::regprocedure and a.grantee=0`)).rows)
          .toEqual([{ privilege_type: 'EXECUTE', is_grantable: false }])
        for (const caller of ['anon', 'authenticated']) {
          for (const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER',
            ...(supportsMaintain ? ['MAINTAIN'] : [])]) {
            expect((await db.query<{ allowed: boolean }>('select has_table_privilege($1,$2,$3) as allowed',
              [caller, `public.${prefix}`, privilege])).rows[0].allowed).toBe(creator === 'supabase_admin')
          }
          for (const privilege of ['USAGE','SELECT','UPDATE']) {
            expect((await db.query<{ allowed: boolean }>('select has_sequence_privilege($1,$2,$3) as allowed',
              [caller, `public.${prefix}_seq`, privilege])).rows[0].allowed).toBe(creator === 'supabase_admin')
          }
          expect((await db.query<{ allowed: boolean }>('select has_function_privilege($1,$2,$3) as allowed',
            [caller, `public.${prefix}_fn()`, 'EXECUTE'])).rows[0].allowed).toBe(true)
        }
        // Individual migrations, not a global default rewrite, close PUBLIC.
        await db.exec(`revoke execute on function public.${prefix}_fn() from public`)
        expect((await db.query<{ allowed: boolean }>(`select has_function_privilege('anon','public.${prefix}_fn()','EXECUTE') as allowed`)).rows[0].allowed).toBe(creator === 'supabase_admin')
      } finally {
        await db.exec(`rollback; drop function if exists public.${prefix}_fn();
          drop sequence if exists public.${prefix}_seq; drop table if exists public.${prefix}`)
      }
    }
  })

  it.each([
    ['unknown creator', 'alter default privileges for role default_creator in schema public grant select on tables to anon',
      'alter default privileges for role default_creator in schema public revoke select on tables from anon'],
    ['known creator global client', 'alter default privileges for role postgres grant select on tables to authenticated',
      'alter default privileges for role postgres revoke select on tables from authenticated'],
    ['known creator PUBLIC', 'alter default privileges for role supabase_admin in schema public grant execute on functions to public',
      'alter default privileges for role supabase_admin in schema public revoke execute on functions from public'],
    ['inherited parent', 'alter default privileges for role postgres in schema public grant usage on sequences to acl_parent; grant acl_parent to anon',
      'revoke acl_parent from anon; alter default privileges for role postgres in schema public revoke usage on sequences from acl_parent'],
    ['grant option', 'alter default privileges for role supabase_admin in schema public grant select on tables to anon with grant option',
      'alter default privileges for role supabase_admin in schema public revoke select on tables from anon'],
    ['unapproved object type', 'alter default privileges for role postgres in schema public grant usage on types to authenticated',
      'alter default privileges for role postgres in schema public revoke usage on types from authenticated'],
    ['platform unexpected schema', 'alter default privileges for role supabase_admin in schema other_acl grant select on tables to anon',
      'alter default privileges for role supabase_admin in schema other_acl revoke select on tables from anon'],
    ['platform nonclient outside public', 'alter default privileges for role supabase_admin in schema other_acl grant usage on sequences to service_role',
      'alter default privileges for role supabase_admin in schema other_acl revoke usage on sequences from service_role'],
    ['platform extra grantee', 'alter default privileges for role supabase_admin in schema public grant execute on functions to acl_parent',
      'alter default privileges for role supabase_admin in schema public revoke execute on functions from acl_parent'],
    ['reachable platform nonclient', 'grant service_role to anon', 'revoke service_role from anon'],
  ])('fails closed on %s and rolls back the complete transaction', async (_label, setup, cleanup) => {
    await drift()
    await db.exec(setup)
    const before = await defaults(), protectedBefore = await protectedState()
    try {
      await expect(db.exec(repair)).rejects.toThrow('Default privilege convergence blocked: unapproved default ACL')
      await db.exec('rollback')
      expect(await defaults()).toEqual(before)
      expect(await protectedState()).toEqual(protectedBefore)
    } finally {
      await db.exec('rollback')
      await db.exec(cleanup)
      await drift() // Restore the complete retained matrix after malformed fixtures.
      await db.exec(repair)
    }
    await expectNoClientDefaults()
  })

  it('preserves known nonclient grant options without requiring client-style options', async () => {
    await db.exec(`alter default privileges for role supabase_admin in schema public
      grant all on tables to postgres,service_role with grant option`)
    const before = await protectedState()
    await db.exec(repair)
    expect(await protectedState()).toEqual(before)
    await db.exec(`alter default privileges for role supabase_admin in schema public
      revoke grant option for all on tables from postgres,service_role`)
  })

  it('rejects explicit global PUBLIC function defaults without rewriting any global row', async () => {
    // Adding a nonclient global function grant materializes built-in PUBLIC in
    // pg_default_acl. It is explicitly NOT the approved NULL built-in baseline.
    await db.exec('alter default privileges for role postgres grant execute on functions to service_role')
    await drift()
    const before = await defaults()
    try {
      await expect(db.exec(repair)).rejects.toThrow('unapproved default ACL')
      await db.exec('rollback')
      expect(await defaults()).toEqual(before)
    } finally {
      await db.exec('rollback; alter default privileges for role postgres revoke execute on functions from service_role')
      await db.exec(repair)
    }
  })

  it('rejects a partial platform matrix instead of treating a known creator as a blanket exception', async () => {
    await drift()
    await db.exec('alter default privileges for role supabase_admin in schema public revoke execute on functions from anon')
    const before = await defaults(), protectedBefore = await protectedState()
    try {
      await expect(db.exec(repair)).rejects.toThrow('partial platform matrix')
      await db.exec('rollback')
      expect(await defaults()).toEqual(before)
      expect(await protectedState()).toEqual(protectedBefore)
    } finally {
      await db.exec('rollback')
      await drift()
      await db.exec(repair)
    }
  })

  it('rejects an empty global platform row that aclexplode alone cannot see', async () => {
    await drift()
    // Synthetic catalog corruption fixture only; the migration never writes catalogs.
    await db.exec('alter default privileges for role supabase_admin grant execute on functions to service_role')
    const original = (await db.query<{ acl: string }>(`select defaclacl::text as acl from pg_default_acl
      where defaclrole='supabase_admin'::regrole and defaclnamespace=0 and defaclobjtype='f'`)).rows[0].acl
    await db.exec(`update pg_default_acl set defaclacl='{}'::aclitem[]
      where defaclrole='supabase_admin'::regrole and defaclnamespace=0 and defaclobjtype='f'`)
    const before = await defaults()
    try {
      await expect(db.exec(repair)).rejects.toThrow('unapproved default ACL')
      await db.exec('rollback')
      expect(await defaults()).toEqual(before)
    } finally {
      await db.exec('rollback')
      await db.query(`update pg_default_acl set defaclacl=$1::aclitem[]
        where defaclrole='supabase_admin'::regrole and defaclnamespace=0 and defaclobjtype='f'`, [original])
      await db.exec('alter default privileges for role supabase_admin revoke execute on functions from service_role')
      await db.exec(repair)
    }
  })

  it('still rejects unauthorized postgres default changes and never escalates the operator', async () => {
    await drift()
    await db.exec('set role acl_operator')
    const before = await defaults(), protectedBefore = await protectedState()
    try {
      await expect(db.exec(repair)).rejects.toThrow('creator postgres requires authorized USAGE or SET')
      await db.exec('rollback')
      expect(await defaults()).toEqual(before)
      expect(await protectedState()).toEqual(protectedBefore)
    } finally {
      await db.exec('rollback; reset role')
      await db.exec(repair)
    }
  })

  it.each(['wrong object privilege', 'duplicate matrix cell'])(
    'rejects forged platform %s instead of silently retaining it', async label => {
    await drift()
    const captured = (await db.query<{ oid: number; acl: string }>(`select oid,defaclacl::text as acl
      from pg_default_acl where defaclrole='supabase_admin'::regrole
        and defaclnamespace='public'::regnamespace and defaclobjtype='S'`)).rows[0]
    // aclitem is untyped; both fixtures are synthetic catalog corruption only.
    if (label === 'wrong object privilege') {
      await db.query(`update pg_default_acl set defaclacl=array_append(defaclacl,
        makeaclitem('anon'::regrole,'supabase_admin'::regrole,'EXECUTE',false)) where oid=$1`, [captured.oid])
    } else {
      // Keep exactly the approved number of cells, but replace one with a duplicate.
      await db.query(`update pg_default_acl d set defaclacl=array(
        select makeaclitem(a.grantee,a.grantor,
          case when a.grantee='anon'::regrole and a.privilege_type='USAGE' then 'SELECT'
            else a.privilege_type end,a.is_grantable)
        from aclexplode(d.defaclacl) a) where oid=$1`, [captured.oid])
    }
    const before = await defaults()
    try {
      await expect(db.exec(repair)).rejects.toThrow('unapproved default ACL')
      await db.exec('rollback')
      expect(await defaults()).toEqual(before)
    } finally {
      await db.exec('rollback')
      await db.query('update pg_default_acl set defaclacl=$1::aclitem[] where oid=$2', [captured.acl, captured.oid])
      await db.exec(repair)
    }
  })

  it('rejects empty platform rows in an unexpected schema', async () => {
    await db.exec('alter default privileges for role supabase_admin in schema other_acl grant select on tables to service_role')
    const captured = (await db.query<{ oid: number; acl: string }>(`select oid,defaclacl::text as acl
      from pg_default_acl where defaclrole='supabase_admin'::regrole
        and defaclnamespace='other_acl'::regnamespace and defaclobjtype='r'`)).rows[0]
    await db.query("update pg_default_acl set defaclacl='{}'::aclitem[] where oid=$1", [captured.oid])
    const before = await defaults()
    try {
      await expect(db.exec(repair)).rejects.toThrow('unapproved default ACL')
      await db.exec('rollback')
      expect(await defaults()).toEqual(before)
    } finally {
      await db.exec('rollback')
      await db.query('update pg_default_acl set defaclacl=$1::aclitem[] where oid=$2', [captured.acl, captured.oid])
      await db.exec('alter default privileges for role supabase_admin in schema other_acl revoke select on tables from service_role')
    }
  })

  it('accepts an authorized postgres repair without any platform USAGE/SET or membership changes', async () => {
    await drift()
    // Inherited postgres ownership is enough; platform authorization is NOT needed.
    await db.exec('grant postgres to acl_operator; set role acl_operator')
    const protectedBefore = await protectedState()
    try {
      expect((await db.query<{ use: boolean; set: boolean }>(`select
        pg_has_role(current_user,'supabase_admin','USAGE') as use,
        pg_has_role(current_user,'supabase_admin','SET') as set`)).rows[0]).toEqual({ use: false, set: false })
      await db.exec(repair)
      await expectNoClientDefaults()
      expect(await protectedState()).toEqual(protectedBefore)
    } finally {
      await db.exec('rollback; reset role; revoke postgres from acl_operator')
      await db.exec(repair)
    }
  })

  it('rejects a non-self grantor rather than normalizing unapproved catalog evidence', async () => {
    await drift(['supabase_admin'])
    const captured = (await db.query<{ oid: number; acl: string }>(`select oid,defaclacl::text as acl
      from pg_default_acl where defaclrole='supabase_admin'::regrole
        and defaclnamespace='public'::regnamespace and defaclobjtype='r'`)).rows[0]
    // Only a superuser synthetic fixture can forge this otherwise unreachable
    // catalog state; production migration never updates system catalogs.
    await db.query(`update pg_default_acl d set defaclacl=array(
      select makeaclitem(a.grantee,'service_role'::regrole,a.privilege_type,a.is_grantable)
      from aclexplode(d.defaclacl) a) where d.oid=$1`, [captured.oid])
    const before = await defaults(), protectedBefore = await protectedState()
    try {
      await expect(db.exec(repair)).rejects.toThrow('unapproved default ACL')
      await db.exec('rollback')
      expect(await defaults()).toEqual(before)
      expect(await protectedState()).toEqual(protectedBefore)
    } finally {
      await db.exec('rollback')
      await db.query('update pg_default_acl set defaclacl=$1::aclitem[] where oid=$2', [captured.acl, captured.oid])
      await db.exec(repair)
    }
  })

  it('supports inherited USAGE authority without requiring an unauthorized SET option', async () => {
    if (version < 160000) return
    await db.exec(`grant postgres to acl_operator with inherit true, set false;
      alter default privileges for role postgres in schema public grant usage on sequences to authenticated;
      set role acl_operator`)
    try {
      expect((await db.query<{ use: boolean; set: boolean }>(`select
        pg_has_role(current_user,'postgres','USAGE') as use,
        pg_has_role(current_user,'postgres','SET') as set`)).rows[0]).toEqual({ use: true, set: false })
      const before = await protectedState()
      await db.exec(repair)
      await expectNoClientDefaults()
      expect(await protectedState()).toEqual(before)
      expect((await db.query<{ role: string }>('select current_user as role')).rows[0].role).toBe('acl_operator')
    } finally {
      await db.exec('rollback; reset role; revoke postgres from acl_operator')
      await db.exec(repair)
    }
  })

  it('uses authorized SET-only postgres membership without changing memberships or the caller role', async () => {
    if (version < 160000) return // Separate SET option did not exist before PG16.
    await db.exec(`grant postgres to acl_operator with inherit false, set true;
      alter default privileges for role postgres in schema public grant select on tables to anon;
      set role acl_operator`)
    const before = await defaults()
    try {
      const authority = (await db.query<{ use: boolean; set: boolean }>(`select
        pg_has_role(current_user,'postgres','USAGE') as use,
        pg_has_role(current_user,'postgres','SET') as set`)).rows[0]
      expect(authority).toEqual({ use: false, set: true })
      const protectedBefore = await protectedState()
      await db.exec(repair)
      await expectNoClientDefaults()
      expect(await protectedState()).toEqual(protectedBefore)
      expect((await db.query<{ role: string }>('select current_user as role')).rows[0].role).toBe('acl_operator')
      expect(await defaults()).not.toEqual(before)
    } finally {
      await db.exec('rollback; reset role; revoke postgres from acl_operator')
      await db.exec(repair)
    }
  })

  it('blocks recovery on a clean baseline instead of granting an assumed matrix', async () => {
    const before = await defaults(), protectedBefore = await protectedState()
    await expect(db.exec(recovery)).rejects.toThrow('Recovery blocked:')
    await db.exec('rollback')
    expect(await defaults()).toEqual(before)
    expect(await protectedState()).toEqual(protectedBefore)
  })
})