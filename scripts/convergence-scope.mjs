// Pure, fail-closed scope validation shared by capture and isolated recovery.
// No database access, process entry point, or inference from old captures.
export const convergenceScope = 'postgres-defaults-existing-app-acl-reorder-retain-exact-platform-v3'

export function assertOwnershipEvidence(catalog) {
  const op = catalog?.operator
  if (catalog?.convergence_scope !== convergenceScope ||
      catalog?.database?.owner !== 'postgres' || catalog.database.operator_is_owner !== true ||
      catalog.database.allow_connections !== true ||
      !Number.isInteger(catalog.database.connection_limit) || catalog.database.connection_limit < -1 ||
      !Object.hasOwn(catalog.database, 'raw_acl') ||
      !(catalog.database.raw_acl === null || typeof catalog.database.raw_acl === 'string') ||
      !Array.isArray(catalog.database.acl) || !catalog.database.acl.length ||
      catalog.database.acl.some(c => typeof c.grantor !== 'string' || typeof c.grantee !== 'string' ||
        !['CREATE', 'CONNECT', 'TEMPORARY'].includes(c.privilege) || typeof c.is_grantable !== 'boolean') ||
      op?.role !== 'postgres' || op.session_role !== 'postgres' ||
      op.superuser !== false || typeof op.bypassrls !== 'boolean' ||
      ['postgres_usage', 'postgres_set', 'pg_database_owner_usage', 'pg_database_owner_set',
        'public_create', 'public_usage', 'database_create', 'database_connect',
        'database_temporary'].some(k => op[k] !== true) ||
      ['supabase_admin_usage', 'supabase_admin_set'].some(k => op[k] !== false) ||
      !catalog.schemas?.some(s => s.nspname === 'public' && s.owner === 'pg_database_owner') ||
      !Array.isArray(catalog.roles) || !Array.isArray(catalog.memberships) ||
      catalog.roles.some(r => !Number.isInteger(r.rolconnlimit) || r.rolconnlimit < -1)) {
    throw new Error('Fresh approved capture required: scope/database owner/effective operator metadata missing or unsupported')
  }
}

export function assertDefaultScope(catalog) {
  const version = Number(catalog.server_version_num)
  if (!Number.isInteger(version) || version < 160000 || !Array.isArray(catalog.defaults) ||
      !Array.isArray(catalog.default_rows))
    throw new Error('Unapproved default ACL capture version/shape')
  const privileges = { r: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER',
    ...(version >= 170000 ? ['MAINTAIN'] : [])], S: ['USAGE', 'SELECT', 'UPDATE'], f: ['EXECUTE'] }
  const reachable = new Set(['anon', 'authenticated'])
  for (let size = -1; size !== reachable.size;) {
    size = reachable.size
    for (const edge of catalog.memberships) if (reachable.has(edge.member)) reachable.add(edge.granted_role)
  }
  // Inventory from the fresh capture. These are retained, never repaired.
  const inventory = { public: ['anon', 'authenticated', 'postgres', 'service_role'],
    extensions: ['postgres'], graphql: ['anon', 'authenticated', 'postgres', 'service_role'],
    graphql_public: ['anon', 'authenticated', 'postgres', 'service_role'],
    realtime: ['postgres', 'dashboard_user'] }
  const allPlatform = catalog.defaults.filter(c => c.creator === 'supabase_admin')
  const platform = allPlatform.filter(c => c.schema === 'public' && ['anon', 'authenticated'].includes(c.grantee))
  const platformRows = catalog.default_rows.filter(c => c.creator === 'supabase_admin' && c.schema === 'public')
  const expected = Object.entries(privileges).flatMap(([type, values]) =>
    ['anon', 'authenticated'].flatMap(grantee => values.map(privilege => JSON.stringify([type, grantee, privilege]))))
  const keys = platform.map(c => JSON.stringify([c.type, c.grantee, c.privilege]))
  if (platform.length && (platform.length !== expected.length || new Set(keys).size !== expected.length ||
      expected.some(key => !keys.includes(key)))) throw new Error('Unapproved default ACL partial/extra platform matrix')
  if (platformRows.length !== (platform.length ? 3 : 0) ||
      new Set(platformRows.map(r => r.type)).size !== platformRows.length ||
      allPlatform.filter(c => c.schema === 'public').some(c => !platformRows.some(r => r.type === c.type && r.raw_acl === c.raw_acl)))
    throw new Error('Unapproved default ACL raw rows/empty platform matrix')
  const rowKeys = catalog.default_rows.map(r => JSON.stringify([r.creator, r.schema, r.type]))
  if (new Set(rowKeys).size !== rowKeys.length || catalog.default_rows.some(r =>
    typeof r.raw_acl !== 'string' || (r.creator === 'supabase_admin' && !inventory[r.schema])) ||
    catalog.defaults.some(c => !catalog.default_rows.some(r =>
      r.creator === c.creator && r.schema === c.schema && r.type === c.type && r.raw_acl === c.raw_acl)))
    throw new Error('Unapproved default ACL raw/semantic evidence mismatch')
  const groupSize = Object.values(privileges).flat().length
  for (const [schema, grantees] of Object.entries(inventory)) {
    const rows = catalog.default_rows.filter(r => r.creator === 'supabase_admin' && r.schema === schema)
    const cells = allPlatform.filter(c => c.schema === schema)
    if (!rows.length && !cells.length) continue
    const groups = schema === 'public' ? grantees.filter(g =>
      ['anon', 'authenticated'].includes(g) || cells.some(c => c.grantee === g)) : grantees
    if (rows.length !== 3 || new Set(rows.map(r => r.type)).size !== 3 ||
        cells.length !== groups.length * groupSize || groups.some(grantee => {
          const keys = cells.filter(c => c.grantee === grantee).map(c => JSON.stringify([c.type, c.privilege]))
          return keys.length !== groupSize || new Set(keys).size !== groupSize ||
            Object.entries(privileges).some(([type, values]) => values.some(p => !keys.includes(JSON.stringify([type, p]))))
        })) throw new Error('Unapproved default ACL retained inventory matrix')
  }
  for (const c of catalog.defaults) {
    if (c.creator === 'supabase_admin' && inventory[c.schema]?.includes(c.grantee) &&
        !['anon', 'authenticated'].includes(c.grantee) && !reachable.has(c.grantee) &&
        c.grantor === c.creator && typeof c.is_grantable === 'boolean' && privileges[c.type]?.includes(c.privilege)) continue
    if (c.creator === 'supabase_admin' && ['graphql', 'graphql_public'].includes(c.schema) &&
        ['anon', 'authenticated'].includes(c.grantee) && c.grantor === c.creator &&
        c.is_grantable === false && privileges[c.type]?.includes(c.privilege)) continue
    if (c.creator !== 'supabase_admin' && !['public', '<global>'].includes(c.schema)) continue
    if (c.creator !== 'supabase_admin' && c.grantee !== 'PUBLIC' && !reachable.has(c.grantee)) continue
    if (!['postgres', 'supabase_admin'].includes(c.creator) || c.schema !== 'public' ||
        !['anon', 'authenticated'].includes(c.grantee) || c.grantor !== c.creator ||
        c.is_grantable !== false || !privileges[c.type]?.includes(c.privilege))
      throw new Error('Unapproved default ACL source/privilege/grantee/grant option')
  }
}