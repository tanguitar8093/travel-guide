import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareCapturedEvidence } from './convergence-capture.mjs'
import { assertDefaultScope, assertOwnershipEvidence, convergenceScope } from './convergence-scope.mjs'

// Pure synthetic private files; no child processes, credentials, or connections.
const directories = []
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })

function fixture() {
  const tables = ['regions','labels','places','place_regions','place_labels','trips',
    'itinerary_items','route_maps','route_map_places','user_roles']
  const functions = ['app_backup_preview_clear()','app_backup_apply_clear(text)',
    'app_backup_account_counts(uuid)','app_backup_has_shared_trip(uuid)',
    'app_backup_account_signature(uuid)','app_backup_assert_payload(jsonb)',
    'app_backup_preview_replace(jsonb)','app_backup_apply_replace(jsonb,text)',
    'can_manage_trip_acl(uuid)','assign_private_record_owner()','assign_route_map_record_owner()']
  const matrix = { r: ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'],
    S: ['USAGE','SELECT','UPDATE'], f: ['EXECUTE'] }
  const catalog = {
    kind: 'catalog', convergence_scope: convergenceScope, server_version_num: '170011',
    database: { owner: 'postgres', operator_is_owner: true, allow_connections: true,
      connection_limit: -1, raw_acl: null,
      acl: [{ grantor: 'postgres', grantee: 'postgres', privilege: 'CREATE', is_grantable: false },
        { grantor: 'postgres', grantee: 'postgres', privilege: 'CONNECT', is_grantable: false },
        { grantor: 'postgres', grantee: 'postgres', privilege: 'TEMPORARY', is_grantable: false },
        { grantor: 'postgres', grantee: 'PUBLIC', privilege: 'CONNECT', is_grantable: false },
        { grantor: 'postgres', grantee: 'PUBLIC', privilege: 'TEMPORARY', is_grantable: false }] },
    operator: { role: 'postgres', session_role: 'postgres', superuser: false, bypassrls: true,
      postgres_usage: true, postgres_set: true, supabase_admin_usage: false, supabase_admin_set: false,
      pg_database_owner_usage: true, pg_database_owner_set: true, public_create: true, public_usage: true,
      database_create: true, database_connect: true, database_temporary: true },
    schemas: [{ nspname: 'public', owner: 'pg_database_owner', raw_acl: null }],
    roles: [], memberships: [], columns: [],
    objects: [...tables.map(name => ({ kind: 'table', identity: `public.${name}`, owner: 'postgres' })),
      ...functions.map(name => ({ kind: 'function', identity: `public.${name}`, owner: 'postgres' }))],
    functions: functions.map(name => ({ identity: `public.${name}`, definition: '-- synthetic fixture' })),
    cells: [{ kind: 'table', identity: 'public.regions', owner: 'postgres', grantor: 'postgres',
      grantee: 'authenticated', privilege: 'TRUNCATE', is_grantable: false }],
    defaults: ['postgres','supabase_admin'].flatMap(creator => Object.entries(matrix).flatMap(([type, values]) =>
      (creator === 'supabase_admin' ? ['anon','authenticated','postgres','service_role'] : ['anon','authenticated']).flatMap(grantee => values.map(privilege => ({ creator, schema: 'public', type,
        grantor: creator, grantee, privilege, is_grantable: false, raw_acl: `{synthetic-${creator}-${type}}` }))))),
  }
  catalog.default_rows = [...new Map(catalog.defaults.map(c => [JSON.stringify([c.creator,c.schema,c.type]),
    { creator: c.creator, schema: c.schema, type: c.type, raw_acl: c.raw_acl }])).values()]
  return catalog
}

function prepare(catalog) {
  const directory = mkdtempSync(join(tmpdir(), 'convergence-fixture-'))
  directories.push(directory)
  writeFileSync(join(directory, 'preinstall.jsonl'), JSON.stringify(catalog) + '\n', { mode: 0o600 })
  return { receipt: prepareCapturedEvidence(directory, true),
    sql: readFileSync(join(directory, 'exact-recovery.UNREHEARSED.sql'), 'utf8') }
}

describe('narrowed convergence evidence and recovery', () => {
  it('prepares only changed postgres defaults without platform authority or SET ROLE', () => {
    const catalog = fixture()
    const { receipt, sql } = prepare(catalog)
    expect(receipt.convergence_scope).toBe(convergenceScope)
    expect(receipt.default_acl_cells_to_restore).toBe(24)
    expect(receipt.retained_platform_default_cells).toBe(48)
    expect(receipt.platform_creator_accessible).toBe(false)
    expect(sql.match(/alter default privileges for role "postgres"/g)).toHaveLength(24)
    expect(sql).not.toMatch(/alter default privileges for role "supabase_admin"/i)
    expect(sql).not.toMatch(/set local role/i)
    expect(sql).toContain('untouched platform raw defaults differ')
    expect(sql).toContain('reorder ACL differs')
    expect(sql).toContain('reorder source/owner/config differs')
    expect(sql).toContain('memberships differ')
    expect(sql).toContain('executor/database ownership/effective schema authority differs')
    expect(sql).toContain('database ACL differs')
    expect(sql).toContain('schema ACL differs')
    expect(sql).toContain('column ACL differs')
    expect(sql).toContain('original function source/owner/config differs')
    expect(sql).toContain("current_setting('server_version_num')")
    expect(receipt.rollback_sources).toHaveLength(3)
    expect(receipt.capture_sources.some(s => s.name === 'scripts/convergence-scope.mjs')).toBe(true)
  })

  it.each(['database','convergence_scope'])('refuses old captures missing %s rather than guessing', key => {
    const catalog = fixture()
    delete catalog[key]
    expect(() => prepare(catalog)).toThrow('Fresh approved capture required')
  })

  it.each(['pg_database_owner_usage','pg_database_owner_set','public_create','public_usage',
    'database_create','database_connect','database_temporary'])(
    'requires fresh explicit effective %s metadata', key => {
      const catalog = fixture()
      delete catalog.operator[key]
      expect(() => prepare(catalog)).toThrow('Fresh approved capture required')
    })

  it.each(['allow_connections','connection_limit','raw_acl','acl'])(
    'refuses ownership-only captures missing database %s', key => {
      const catalog = fixture()
      delete catalog.database[key]
      expect(() => prepare(catalog)).toThrow('Fresh approved capture required')
    })

  it('refuses an operator with newly added platform authority', () => {
    const catalog = fixture()
    catalog.operator.supabase_admin_set = true
    expect(() => prepare(catalog)).toThrow('Fresh approved capture required')
  })

  it('rejects incomplete database ACL evidence and old role attributes', () => {
    const catalog = fixture()
    catalog.database.acl[0].privilege = 'UNREVIEWED'
    expect(() => prepare(catalog)).toThrow('Fresh approved capture required')
    catalog.database.acl[0].privilege = 'CREATE'
    catalog.roles.push({ rolname: 'postgres' })
    expect(() => prepare(catalog)).toThrow('Fresh approved capture required')
  })

  it('rejects the former bootstrap-owned database even when roles and memberships match', () => {
    const catalog = fixture()
    catalog.database.owner = 'supabase_admin'
    expect(() => assertOwnershipEvidence(catalog)).toThrow('Fresh approved capture required')
  })

  it('accepts no platform defaults and sparse postgres defaults', () => {
    const catalog = fixture()
    catalog.defaults = catalog.defaults.filter(c => c.creator === 'postgres').slice(0, 1)
    catalog.default_rows = catalog.default_rows.filter(c => c.creator === 'postgres' && c.type === 'r')
    expect(() => assertDefaultScope(catalog)).not.toThrow()
    expect(prepare(catalog).receipt.default_acl_cells_to_restore).toBe(1)
  })

  it('accepts a clean baseline with no explicit default ACL rows at all', () => {
    const catalog = fixture()
    catalog.defaults = []
    catalog.default_rows = []
    const { receipt, sql } = prepare(catalog)
    expect(receipt.default_acl_cells_to_restore).toBe(0)
    expect(receipt.retained_platform_default_cells).toBe(0)
    expect(sql).not.toMatch(/alter default privileges for role/i)
    expect(sql).toContain("to_regrole('supabase_admin')")
  })

  it.each(['partial','duplicate','grantor','grantee','option','global','unexpected schema','privilege','inherited','PUBLIC'])(
    'rejects malformed platform evidence: %s', drift => {
      const catalog = fixture()
      const cell = catalog.defaults.find(c => c.creator === 'supabase_admin')
      if (drift === 'partial') catalog.defaults.splice(catalog.defaults.indexOf(cell), 1)
      if (drift === 'duplicate') Object.assign(cell, catalog.defaults[catalog.defaults.indexOf(cell) + 1])
      if (drift === 'grantor') cell.grantor = 'postgres'
      if (drift === 'grantee') cell.grantee = 'service_role'
      if (drift === 'option') cell.is_grantable = true
      if (drift === 'global') cell.schema = '<global>'
      if (drift === 'unexpected schema') cell.schema = 'auth'
      if (drift === 'privilege') cell.privilege = 'FUTURE_PRIVILEGE'
      if (drift === 'PUBLIC') cell.grantee = 'PUBLIC'
      if (drift === 'inherited') {
        cell.grantee = 'parent'
        catalog.memberships.push({ member: 'anon', granted_role: 'parent' })
      }
      expect(() => prepare(catalog)).toThrow(/Unapproved default ACL/)
    })

  it('rejects changed object ownership rather than generating a privileged recovery', () => {
    const catalog = fixture()
    catalog.objects[0].owner = 'supabase_admin'
    expect(() => prepare(catalog)).toThrow('unsupported object owner/grantor authority')
  })

  it('rejects empty platform catalog rows hidden by aclexplode', () => {
    const catalog = fixture()
    catalog.defaults = catalog.defaults.filter(c => c.creator !== 'supabase_admin')
    expect(() => prepare(catalog)).toThrow('empty platform matrix')
  })

  it('rejects empty global platform rows hidden by aclexplode', () => {
    const catalog = fixture()
    catalog.default_rows.push({ creator: 'supabase_admin', schema: '<global>', type: 'f', raw_acl: '{}' })
    expect(() => prepare(catalog)).toThrow('Unapproved default ACL')
  })

  it('preserves known nonclient grant options in raw and semantic recovery guards', () => {
    const catalog = fixture()
    for (const c of catalog.defaults) if (c.creator === 'supabase_admin' && c.grantee === 'postgres') c.is_grantable = true
    const { receipt, sql } = prepare(catalog)
    expect(receipt.retained_platform_default_cells).toBe(48)
    expect(receipt.default_acl_cells_to_restore).toBe(24)
    expect(sql).toContain('["supabase_admin","public","r","supabase_admin","postgres","SELECT",true]')
    expect(sql).toContain('{synthetic-supabase_admin-r}')
    expect(sql).not.toMatch(/alter default privileges for role "supabase_admin"/i)
  })

  it.each(['unknown', 'inherited', 'partial nonclient'])('rejects retained nonclient drift: %s', drift => {
    const catalog = fixture()
    const cell = catalog.defaults.find(c => c.creator === 'supabase_admin' && c.grantee === 'service_role')
    if (drift === 'unknown') cell.grantee = 'unreviewed'
    if (drift === 'inherited') catalog.memberships.push({ member: 'anon', granted_role: 'service_role' })
    if (drift === 'partial nonclient') catalog.defaults.splice(catalog.defaults.indexOf(cell), 1)
    expect(() => prepare(catalog)).toThrow(/Unapproved default ACL/)
  })

  it('retains the complete known outside-platform inventory including nonclient options', () => {
    const catalog = fixture()
    for (const [schema, grantees] of Object.entries({ extensions: ['postgres'],
      graphql: ['anon','authenticated','postgres','service_role'],
      graphql_public: ['anon','authenticated','postgres','service_role'], realtime: ['postgres','dashboard_user'] })) {
      for (const c of catalog.defaults.filter(c => c.creator === 'supabase_admin' && c.schema === 'public' && grantees.includes(c.grantee)))
        catalog.defaults.push({ ...c, schema, is_grantable: schema === 'extensions', raw_acl: `{synthetic-${schema}-${c.type}}` })
      if (schema === 'realtime') for (const c of catalog.defaults.filter(c => c.creator === 'supabase_admin' && c.schema === 'public' && c.grantee === 'postgres'))
        catalog.defaults.push({ ...c, schema, grantee: 'dashboard_user', raw_acl: `{synthetic-${schema}-${c.type}}` })
    }
    catalog.default_rows = [...new Map(catalog.defaults.map(c => [JSON.stringify([c.creator,c.schema,c.type]),
      { creator: c.creator, schema: c.schema, type: c.type, raw_acl: c.raw_acl }])).values()]
    const { receipt, sql } = prepare(catalog)
    expect(receipt.retained_platform_default_cells).toBe(180)
    expect(sql).toContain('{synthetic-extensions-r}')
    expect(sql).not.toMatch(/alter default privileges for role "supabase_admin"/i)
  })

  it('rejects empty platform rows outside public even when the public matrix is exact', () => {
    const catalog = fixture()
    catalog.default_rows.push({ creator: 'supabase_admin', schema: 'auth', type: 'r', raw_acl: '{}' })
    expect(() => prepare(catalog)).toThrow('Unapproved default ACL')
  })

  it('retains the exact platform matrix with sparse postgres drift, never treating sparse platform as approved', () => {
    const catalog = fixture()
    catalog.defaults = catalog.defaults.filter(c => c.creator === 'supabase_admin' ||
      (c.type === 'S' && c.grantee === 'authenticated' && c.privilege === 'UPDATE'))
    catalog.default_rows = catalog.default_rows.filter(c => c.creator === 'supabase_admin' || c.type === 'S')
    const { receipt, sql } = prepare(catalog)
    expect(receipt.default_acl_cells_to_restore).toBe(1)
    expect(receipt.retained_platform_default_cells).toBe(48)
    expect(sql.match(/alter default privileges for role "postgres"/g)).toHaveLength(1)
    expect(sql).toContain('grant UPDATE on sequences to "authenticated"')
    expect(sql).not.toMatch(/alter default privileges for role "supabase_admin"/i)
  })

  it('bounds the allowlist to the captured server version, including MAINTAIN only from PG17', () => {
    const catalog = fixture()
    catalog.server_version_num = '160015'
    expect(() => prepare(catalog)).toThrow('Unapproved default ACL')
    catalog.defaults = catalog.defaults.filter(c => c.privilege !== 'MAINTAIN')
    const { receipt, sql } = prepare(catalog)
    expect(receipt.default_acl_cells_to_restore).toBe(22)
    expect(receipt.retained_platform_default_cells).toBe(44)
    expect(sql).not.toMatch(/grant MAINTAIN/i)
  })

  it('rejects mismatched raw rows rather than trusting a detached semantic matrix', () => {
    const catalog = fixture()
    catalog.default_rows.find(c => c.creator === 'postgres').raw_acl = '{different}'
    expect(() => prepare(catalog)).toThrow('raw/semantic evidence mismatch')
  })

  it('keeps the isolated driver on equivalent execution with database ownership restored first', () => {
    const source = readFileSync(new URL('./convergence-backup.mjs', import.meta.url), 'utf8')
    expect(source).toContain('alter database postgres owner to')
    expect(source).toContain('synthetic-database-context.private.sql')
    expect(source).toContain('catalog.database.acl')
    expect(source).toContain('receipt.rollback_sources.some')
    expect(source).toContain('backupStatus.evidence_hashes.some')
    expect(source).toContain('frozen ownership/catalog evidence missing or changed')
    expect(source).toContain('exact_migration_acl_and_owners')
    expect(source).toContain('with ordinality item(acl,position)')
    expect(source).toContain('order by item.position,a.is_grantable')
    expect(source).not.toMatch(/update\s+pg_default_acl/i)
    expect(source).toContain('Operator migration differs from exact captured ACL/default/object poststate')
    expect(source.indexOf('alter database postgres owner to')).toBeLessThan(source.indexOf("const after = captureLocal('restored')"))
    expect(source).not.toMatch(/grant create on schema public/i)
    expect(source).not.toContain('migration_synthetic_platform')
    expect(source).not.toContain('expected platform privilege guard failure')
    expect(source).toContain('old scope archives cannot be upgraded or regenerated')
    expect(source).toContain("PGUSER: catalog.operator.role")
  })
})