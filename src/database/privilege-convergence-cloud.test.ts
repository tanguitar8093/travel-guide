import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import convergence from '../../supabase/migrations/20261020010000_privilege_convergence.sql?raw'
import recovery from '../../supabase/rollback/20261020010000_privilege_convergence.sql?raw'
import inventory from '../../supabase/inspection/privilege_convergence.sql?raw'
import type { SharedTripSnapshot } from './shared-trip.types'

// Synthetic, isolated current chain only. Never loads environment credentials.
// Existing suites are deliberately unchanged; adopt this chain there only after
// approval so their backup/shared/Dexie auto-sync coverage also exercises A.
const migrations = import.meta.glob<string>('../../supabase/migrations/*.sql', {
  eager: true, query: '?raw', import: 'default',
})
const db = new PGlite()
const owner = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const admin = '33333333-3333-4333-8333-333333333333'
const basic = '44444444-4444-4444-8444-444444444444'
const tables = ['regions', 'labels', 'places', 'place_regions', 'place_labels',
  'trips', 'itinerary_items', 'route_maps', 'route_map_places', 'user_roles']
const helpers = ['app_backup_preview_clear()', 'app_backup_apply_clear(text)',
  'app_backup_account_counts(uuid)', 'app_backup_has_shared_trip(uuid)',
  'app_backup_account_signature(uuid)', 'app_backup_assert_payload(jsonb)',
  'app_backup_preview_replace(jsonb)', 'app_backup_apply_replace(jsonb,text)',
  'can_manage_trip_acl(uuid)']
const triggers = ['assign_private_record_owner()', 'assign_route_map_record_owner()']
const qualifiedTables = tables.map((name) => `public.${name}`).join(',')
const qualifiedFunctions = [...helpers, ...triggers].map((name) => `public.${name}`).join(',')
const backup = { format: 'travel-planner-backup', version: 1, data: {} }
let originalProtected: unknown
let baselineAcl: unknown

async function asUser<T>(uid: string | null, work: () => Promise<T>, role = 'authenticated'): Promise<T> {
  await db.exec(`begin; set local role ${role};`)
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [uid ?? ''])
    const value = await work()
    await db.exec('commit')
    return value
  } catch (error) {
    await db.exec('rollback')
    throw error
  }
}

async function rpc<T = Record<string, unknown>>(name: string, args: unknown[] = []): Promise<T> {
  const parameters = args.map((_, i) => `$${i + 1}`).join(',')
  return (await db.query<{ result: T }>(`select public.${name}(${parameters}) as result`, args)).rows[0].result
}

async function drift() {
  await db.exec(`grant truncate,references,trigger on ${qualifiedTables} to authenticated;
    grant select,insert,update,delete,truncate,references,trigger on public.user_roles to anon;
    grant execute on function ${qualifiedFunctions} to anon;
    grant execute on function public.assign_private_record_owner(),public.assign_route_map_record_owner() to authenticated;`)
}

async function aclState() {
  return (await db.query(`select 'table' as kind,oid,relowner as owner,relacl::text as acl
    from pg_class where relnamespace='public'::regnamespace
    union all select 'function',oid,proowner,proacl::text
    from pg_proc where pronamespace='public'::regnamespace
    order by kind,oid`)).rows
}

async function protectedState() {
  return {
    // All non-client ACL entries: platform/owner grantors and grant options too.
    acl: (await db.query(`select 'table' as kind,c.oid,c.relowner as owner,a.*
      from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      where c.relnamespace='public'::regnamespace and a.grantee not in ('anon'::regrole,'authenticated'::regrole)
      union all select 'function',p.oid,p.proowner,a.*
      from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.pronamespace='public'::regnamespace and a.grantee not in ('anon'::regrole,'authenticated'::regrole)
      order by kind,oid,grantor,grantee,privilege_type`)).rows,
    schemas: (await db.query('select oid,nspowner,nspacl::text from pg_namespace order by oid')).rows,
    memberships: (await db.query('select to_jsonb(m) as row from pg_auth_members m order by roleid,member,grantor')).rows,
    roles: (await db.query('select to_jsonb(r) as row from public.user_roles r order by user_id')).rows,
    data: (await db.query('select to_jsonb(r) as row from public.regions r order by id')).rows,
    unrelated: (await db.query("select relacl::text from pg_class where oid='public.unrelated_acl_probe'::regclass")).rows,
  }
}

async function fixture() {
  const regionId = crypto.randomUUID(), tripId = crypto.randomUUID(), placeId = crypto.randomUUID()
  const ids = [crypto.randomUUID(), crypto.randomUUID()]
  await asUser(owner, async () => {
    await db.query("insert into public.regions(id,name,google_place_id,zoom) values($1,'Region','region',12)", [regionId])
    await db.query("insert into public.places(id,name,google_place_id) values($1,'Place','place')", [placeId])
    await db.query(`insert into public.trips(id,region_id,name,start_date,end_date)
      values($1,$2,'Trip','2026-10-20','2026-10-21')`, [tripId, regionId])
    for (const [order, id] of ids.entries()) {
      await db.query(`insert into public.itinerary_items(id,trip_id,place_id,date,sort_order)
        values($1,$2,$3,'2026-10-20',$4)`, [id, tripId, placeId, order])
    }
    const mapId = crypto.randomUUID()
    await db.query("insert into public.route_maps(id,trip_id,name,transport) values($1,$2,'Map','WALKING')", [mapId, tripId])
    await db.query("insert into public.route_map_places(id,route_map_id,google_place_id) values($1,$2,'marker')", [crypto.randomUUID(), mapId])
    await db.query('insert into public.place_regions(place_id,region_id) values($1,$2)', [placeId, regionId])
  })
  return { regionId, tripId, ids }
}

beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create role acl_parent; create role default_creator;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;`)
  const paths = Object.keys(migrations).sort()
  expect(paths.some((p) => p.endsWith('/20261020020000_atomic_itinerary_reorder.sql'))).toBe(true)
  expect(paths.filter((p) => p.endsWith('/20261020010000_privilege_convergence.sql'))).toHaveLength(1)
  for (const path of paths) {
    if (path.endsWith('/20261020010000_privilege_convergence.sql')) {
      await db.exec(`insert into auth.users values
        ('${owner}','owner@example.test'),('${other}','other@example.test'),
        ('${admin}','admin@example.test'),('${basic}','basic@example.test');
        update public.user_roles set role='member' where user_id in ('${owner}','${other}');
        update public.user_roles set role='admin' where user_id='${admin}';
        create table public.unrelated_acl_probe(id integer);
        grant all on public.unrelated_acl_probe to anon,authenticated,service_role;
        grant all on ${qualifiedTables} to service_role with grant option;
        grant execute on function ${qualifiedFunctions} to service_role with grant option;`)
      baselineAcl = await aclState()
      originalProtected = await protectedState()
      await drift()
      await db.exec(migrations[path])
      expect(await aclState()).toEqual(baselineAcl)
      expect(await protectedState()).toEqual(originalProtected)
    } else {
      await db.exec(migrations[path].replace('create extension if not exists pgcrypto;', ''))
    }
  }
}, 120000)

afterAll(async () => { await db.close() })

describe('A privilege convergence on the full sorted synthetic chain', () => {
  it('is idempotent; preserves exact owner/platform/unrelated ACLs, memberships and role/data rows', async () => {
    const before = await aclState(), protectedBefore = await protectedState()
    await db.exec(convergence)
    expect(await aclState()).toEqual(before)
    expect(await protectedState()).toEqual(protectedBefore)
  })

  it('preserves intended helper access, removes only specified extras, and denies TRUNCATE', async () => {
    for (const name of tables) {
      for (const role of ['anon', 'authenticated']) {
        for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
          const result = await db.query<{ allowed: boolean }>(
            'select has_table_privilege($1,$2,$3) as allowed', [role, `public.${name}`, privilege])
          expect(result.rows[0].allowed, `${role} ${name} ${privilege}`)
            .toBe(role === 'authenticated' && ['SELECT', 'INSERT', 'UPDATE', 'DELETE'].includes(privilege))
        }
      }
    }
    for (const name of [...helpers, ...triggers]) {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        const result = await db.query<{ allowed: boolean }>(
          'select has_function_privilege($1,$2,$3) as allowed', [role, `public.${name}`, 'EXECUTE'])
        expect(result.rows[0].allowed, `${role} ${name}`).toBe(role === 'service_role' || (role === 'authenticated' && helpers.includes(name)))
      }
    }
    for (const uid of [owner, admin, basic]) {
      for (const name of tables) {
        await expect(asUser(uid, () => db.exec(`truncate public.${name}`))).rejects.toThrow('permission denied')
      }
    }
    await asUser(owner, () => rpc('app_backup_account_counts', [owner]))
    await asUser(owner, () => rpc('app_backup_account_signature', [owner]))
    await asUser(owner, () => rpc('app_backup_has_shared_trip', [owner]))
    await asUser(owner, () => rpc('app_backup_assert_payload', [backup]))
    await expect(asUser(null, () => rpc('app_backup_preview_clear'), 'anon')).rejects.toThrow('permission denied')
  })

  it.each([
    ['PUBLIC table', 'grant truncate on public.regions to public', 'revoke truncate on public.regions from public'],
    ['inherited table', 'grant truncate on public.regions to acl_parent; grant acl_parent to authenticated',
      'revoke acl_parent from authenticated; revoke truncate on public.regions from acl_parent'],
    ['PUBLIC helper', 'grant execute on function public.app_backup_preview_clear() to public',
      'revoke execute on function public.app_backup_preview_clear() from public'],
    ['inherited trigger', 'grant execute on function public.assign_private_record_owner() to acl_parent; grant acl_parent to authenticated',
      'revoke acl_parent from authenticated; revoke execute on function public.assign_private_record_owner() from acl_parent'],
    ['column references', 'grant references(name) on public.regions to anon', 'revoke references(name) on public.regions from anon'],
    ['CRUD grant option', 'grant select on public.regions to authenticated with grant option',
      'revoke grant option for select on public.regions from authenticated'],
  ])('fails closed for %s and rolls ALL direct revokes back', async (_label, setup, cleanup) => {
    const clean = await aclState()
    try {
      await drift()
      await db.exec(setup)
      const before = await aclState()
      await expect(db.exec(convergence)).rejects.toThrow('Privilege convergence blocked:')
      await db.exec('rollback')
      expect(await aclState()).toEqual(before)
    } finally {
      await db.exec('rollback')
      await db.exec(cleanup)
      await db.exec(convergence)
    }
    expect(await aclState()).toEqual(clean)
  })

  it.each([
    ['schema direct', 'for role default_creator in schema public grant all on tables to anon',
      'for role default_creator in schema public revoke all on tables from anon'],
    ['global direct', 'for role default_creator grant execute on functions to authenticated',
      'for role default_creator revoke execute on functions from authenticated'],
    ['schema PUBLIC', 'for role default_creator in schema public grant execute on functions to public',
      'for role default_creator in schema public revoke execute on functions from public'],
    ['inherited default', 'for role default_creator in schema public grant all on sequences to acl_parent',
      'for role default_creator in schema public revoke all on sequences from acl_parent'],
  ])('gates unapproved %s defaults without changing creator ACLs or objects', async (label, grant, revoke) => {
    const clean = await aclState()
    try {
      if (label === 'inherited default') await db.exec('grant acl_parent to anon')
      await db.exec(`alter default privileges ${grant}`)
      await drift()
      const before = await aclState()
      const defaults = (await db.query('select to_jsonb(d) as row from pg_default_acl d order by oid')).rows
      await expect(db.exec(convergence)).rejects.toThrow('unapproved default ACL')
      await db.exec('rollback')
      expect(await aclState()).toEqual(before)
      expect((await db.query('select to_jsonb(d) as row from pg_default_acl d order by oid')).rows).toEqual(defaults)
    } finally {
      await db.exec('rollback')
      await db.exec(`alter default privileges ${revoke}`)
      // Global function ACL now explicitly omits authenticated but retains
      // built-in PUBLIC EXECUTE; reset exactly to built-in NULL-row semantics.
      if (label === 'global direct') await db.exec('alter default privileges for role default_creator grant execute on functions to public')
      if (label === 'inherited default') await db.exec('revoke acl_parent from anon')
      await db.exec(convergence)
    }
    expect(await aclState()).toEqual(clean)
  })

  it('leaves platform-only defaults unchanged and inventory reads only catalogs', async () => {
    await db.exec('alter default privileges for role default_creator in schema public grant all on tables to service_role')
    try {
      const before = (await db.query('select to_jsonb(d) as row from pg_default_acl d order by oid')).rows
      await db.exec(convergence)
      await db.exec(inventory)
      expect((await db.query('select to_jsonb(d) as row from pg_default_acl d order by oid')).rows).toEqual(before)
    } finally {
      await db.exec('rollback')
      await db.exec('alter default privileges for role default_creator in schema public revoke all on tables from service_role')
    }
  })

  it('blocks the recovery template rather than restoring insecure broad permissions', async () => {
    const before = await aclState()
    await expect(db.exec(recovery)).rejects.toThrow('Recovery blocked:')
    await db.exec('rollback')
    expect(await aclState()).toEqual(before)
  })

  it('keeps own CRUD, cross-owner isolation/admin access, owner triggers and role escalation guards', async () => {
    const f = await fixture()
    expect((await asUser(owner, () => db.query('select id from public.regions where id=$1', [f.regionId]))).rows).toHaveLength(1)
    for (const uid of [other, basic]) {
      expect((await asUser(uid, () => db.query('select id from public.regions where id=$1', [f.regionId]))).rows).toEqual([])
      expect((await asUser(uid, () => db.query('update public.regions set name=$1 where id=$2 returning id', ['Denied', f.regionId]))).rows).toEqual([])
      expect((await asUser(uid, () => db.query("update public.user_roles set role='admin' where user_id=$1 returning user_id", [uid]))).rows).toEqual([])
    }
    await expect(asUser(basic, () => db.query("insert into public.regions(name,google_place_id,zoom) values('Denied','denied',12)"))).rejects.toThrow()
    await expect(asUser(null, () => db.query('select * from public.regions'), 'anon')).rejects.toThrow('permission denied')
    await expect(asUser(owner, () => db.query('update public.regions set owner_uid=$1 where id=$2', [other, f.regionId]))).rejects.toThrow()
    await asUser(admin, () => db.query("update public.regions set name='Admin edit' where id=$1", [f.regionId]))
    expect((await asUser(admin, () => db.query('select name from public.regions where id=$1', [f.regionId]))).rows).toEqual([{ name: 'Admin edit' }])
    await asUser(owner, () => db.query("select public.app_reorder_itinerary_items($1,'2026-10-20',$2::uuid[])", [f.tripId, [...f.ids].reverse()]))
    await asUser(owner, () => db.query('delete from public.trips where id=$1', [f.tripId]))
    expect((await db.query('select id from public.itinerary_items where trip_id=$1', [f.tripId])).rows).toEqual([])
  })

  it('preserves backup authorization/token guards and personal sync push/pull after convergence', async () => {
    for (const [name, args] of [
      ['app_backup_preview_clear', []], ['app_backup_apply_clear', ['bad-token']],
      ['app_backup_preview_replace', [backup]], ['app_backup_apply_replace', [backup, 'bad-token']],
      ['app_sync_snapshot', []], ['app_sync_pull', ['0', 100]],
      ['app_sync_push', [{ protocolVersion: 1, account: { userId: basic }, operationId: crypto.randomUUID(), changes: [] }]],
    ] as const) {
      await expect(asUser(basic, () => rpc(name, [...args]))).rejects.toThrow()
      await expect(asUser(null, () => rpc(name, [...args]), 'anon')).rejects.toThrow('permission denied')
    }
    await asUser(other, () => rpc('app_backup_preview_clear'))
    await asUser(other, () => rpc('app_backup_preview_replace', [backup]))
    await expect(asUser(other, () => rpc('app_backup_apply_clear', ['bad-token']))).rejects.toThrow()
    await expect(asUser(other, () => rpc('app_backup_apply_replace', [backup, 'bad-token']))).rejects.toThrow()
    const id = crypto.randomUUID()
    const snapshot = await asUser(other, () => rpc<{ cursor: string }>('app_sync_snapshot'))
    const task = { protocolVersion: 1, operationId: crypto.randomUUID(), account: { userId: other },
      changes: [{ entity: 'regions', id, kind: 'put', baseVersion: null,
        after: { id, name: 'Sync', googlePlaceId: 'sync', zoom: 12 } }] }
    const result = await asUser(other, () => rpc('app_sync_push', [task]))
    expect(result.status).toBe('applied')
    expect(await asUser(other, () => rpc('app_sync_push', [task]))).toEqual(result)
    const pulled = await asUser(other, () => rpc<{ changes: Array<{ id: string }> }>('app_sync_pull', [snapshot.cursor, 100]))
    expect(pulled.changes).toEqual(expect.arrayContaining([expect.objectContaining({ id })]))
    const clear = await asUser(other, () => rpc<{ token: string }>('app_backup_preview_clear'))
    await asUser(other, () => rpc('app_backup_apply_clear', [clear.token]))
    expect((await asUser(other, () => db.query('select id from public.regions where id=$1', [id]))).rows).toEqual([])
    const replace = await asUser(other, () => rpc<{ token: string }>('app_backup_preview_replace', [backup]))
    await asUser(other, () => rpc('app_backup_apply_replace', [backup, replace.token]))
  })

  it('preserves shared enable/save and immediate revocation, plus shared backup guards', async () => {
    const { tripId } = await fixture()
    const invitation = await asUser(owner, () => rpc<{ invitationId: string }>('app_trip_collaboration',
      ['invite', tripId, { inviteeUserId: other, role: 'editor' }]))
    await asUser(other, () => rpc('app_trip_collaboration', ['accept', tripId, { invitationId: invitation.invitationId }]))
    await asUser(owner, () => rpc('app_shared_trip', ['enable', tripId, {}]))
    const snapshots = await asUser(other, () => rpc<SharedTripSnapshot[]>('app_shared_trip', ['snapshot', null, {}]))
    const shared = snapshots.find((row) => row.id === tripId)
    if (!shared?.document) throw new Error('Missing shared fixture document')
    const payload = { operationId: crypto.randomUUID(), baseVersion: shared.version,
      places: shared.document.places, items: shared.document.items }
    expect((await asUser(other, () => rpc('app_shared_trip', ['save', tripId, payload]))).status).toBe('applied')
    await expect(asUser(owner, () => rpc('app_backup_preview_clear'))).rejects.toThrow()
    await expect(asUser(owner, () => rpc('app_backup_preview_replace', [backup]))).rejects.toThrow()
    await asUser(owner, () => rpc('app_trip_collaboration', ['remove_member', tripId, { userId: other }]))
    await expect(asUser(other, () => rpc('app_shared_trip', ['save', tripId, { ...payload, operationId: crypto.randomUUID() }]))).rejects.toThrow()
    await expect(asUser(other, () => rpc('app_trip_collaboration', ['details', tripId, {}]))).rejects.toThrow()
  })
})