// Read-only evidence, NOT a pg_dump substitute or live installation entry point.
import { spawnSync } from 'node:child_process'
import { chmodSync, closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { assertDefaultScope, assertOwnershipEvidence, convergenceScope } from './convergence-scope.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
export function prepareCapturedEvidence(directory, consistentDump = false) {
const save = (name, data) => writeFileSync(join(directory, name), data, { mode: 0o600, flag: 'wx' })
const evidence = join(directory, 'preinstall.jsonl')
let records
try {
  records = readFileSync(evidence, 'utf8').trim().split('\n').map(line => JSON.parse(line))
} catch {
  throw new Error('Private capture parse failed; contents intentionally omitted.')
}
return prepare(records, directory, save, consistentDump)
}

function main() {
process.umask(0o077)
const base = join(homedir(), '.local/state/travel-guide-backups')
mkdirSync(base, { recursive: true, mode: 0o700 })
chmodSync(base, 0o700)
const directory = mkdtempSync(join(base, 'convergence-'))
const save = (name, data) => writeFileSync(join(directory, name), data, { mode: 0o600, flag: 'wx' })
const evidence = join(directory, 'preinstall.jsonl')
const fd = openSync(evidence, 'wx', 0o600)
const result = spawnSync(process.execPath, ['scripts/db-psql.mjs', '-qAt', '-f', 'scripts/convergence-capture.sql'], {
  cwd: root, env: { ...process.env, PGOPTIONS: '-c default_transaction_read_only=on' },
  stdio: ['ignore', fd, 'pipe'], encoding: 'utf8', maxBuffer: 1024 * 1024,
})
closeSync(fd)
if (result.status !== 0) {
  save('capture-error.log', result.stderr || 'Unable to start read-only capture')
  console.error('Capture incomplete; diagnostics retained privately.')
  process.exit(1)
}
prepareCapturedEvidence(directory)
}

function prepare(records, directory, save, consistentDump) {
const catalog = records.find(r => r.kind === 'catalog')
assertOwnershipEvidence(catalog)
assertDefaultScope(catalog)
const fingerprints = records.filter(r => r.kind === 'fingerprint')
const tables = ['regions','labels','places','place_regions','place_labels','trips',
  'itinerary_items','route_maps','route_map_places','user_roles'].map(n => `public.${n}`)
const functions = ['app_backup_preview_clear()','app_backup_apply_clear(text)',
  'app_backup_account_counts(uuid)','app_backup_has_shared_trip(uuid)',
  'app_backup_account_signature(uuid)','app_backup_assert_payload(jsonb)',
  'app_backup_preview_replace(jsonb)','app_backup_apply_replace(jsonb,text)',
  'can_manage_trip_acl(uuid)','assign_private_record_owner()','assign_route_map_record_owner()']
  .map(n => `public.${n}`)
const normalize = s => s.replaceAll(', ', ',')
const isFunction = identity => functions.includes(normalize(identity))
const removedCell = c => (c.kind === 'table' && tables.includes(c.identity) && (
  (c.grantee === 'authenticated' && ['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'].includes(c.privilege)) ||
  (c.identity === 'public.user_roles' && c.grantee === 'anon'))) ||
  (c.kind === 'function' && isFunction(c.identity) && (c.grantee === 'anon' ||
    (c.grantee === 'authenticated' && /public\.assign_(private|route_map)_record_owner\(\)/.test(c.identity))))
const removedDefault = c => c.schema === 'public' && c.creator === 'postgres'
  && ['anon','authenticated'].includes(c.grantee)
const cells = catalog.cells.filter(removedCell)
const defaults = catalog.defaults.filter(removedDefault)
const reorder = 'public.app_reorder_itinerary_items(uuid, date, uuid[])'
const q = s => `'${s.replaceAll("'", "''")}'`
const ident = s => `"${s.replaceAll('"', '""')}"`
if (catalog.functions.some(f => normalize(f.identity) === normalize(reorder)) ||
  tables.some(t => !catalog.objects.some(o => o.kind === 'table' && o.identity === t)) ||
  functions.some(f => !catalog.functions.some(o => normalize(o.identity) === f)) ||
  [...cells, ...defaults].some(c => c.is_grantable || c.grantor !== (c.creator ?? 'postgres'))) {
  save('preparation-blocked.txt', 'Unexpected identity/source/options or existing reorder; manual reconciliation required.\n')
  console.error('Recovery preparation blocked; capture retained privately.')
  throw new Error('Recovery preparation blocked: unexpected identity/source/options or existing reorder')
}
const cellKey = c => [c.kind,c.identity,c.owner,c.grantor,c.grantee,c.privilege,c.is_grantable]
const defaultKey = c => [c.creator,c.schema,c.type,c.grantor,c.grantee,c.privilege,c.is_grantable]
const compare = (query, expected, message) => `do $guard$ begin
  if (select coalesce(jsonb_agg(v order by v),'[]'::jsonb) from (${query}) s(v)) is distinct from
    (select coalesce(jsonb_agg(v order by v),'[]'::jsonb) from jsonb_array_elements(${q(JSON.stringify(expected))}::jsonb) s(v))
  then raise exception ${q(message)}; end if;
end $guard$;\n`
const identities = catalog.objects.filter(o => tables.includes(o.identity) || (o.kind === 'function' && isFunction(o.identity)))
const targetCells = catalog.cells.filter(c => tables.includes(c.identity) || (c.kind === 'function' && isFunction(c.identity)))
if (identities.length !== 21 || identities.some(o => o.owner !== 'postgres') ||
    [...cells, ...defaults].some(c => c.grantor !== catalog.operator.role))
  throw new Error('Recovery preparation blocked: unsupported object owner/grantor authority')
const aclQuery = `select jsonb_build_array(o.kind,o.identity,o.owner,a.grantor::regrole::text,
  case when a.grantee=0 then 'PUBLIC' else a.grantee::regrole::text end,a.privilege_type,a.is_grantable)
  from (select 'table'::text kind,format('%I.%I',n.nspname,c.relname) identity,c.relowner::regrole::text owner,c.relacl acl,c.relowner owner_oid,'r'::"char" typ
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    union all select 'function',format('%I.%I(%s)',n.nspname,p.proname,oidvectortypes(p.proargtypes)),p.proowner::regrole::text,p.proacl,p.proowner,'f'::"char"
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace) o
  cross join lateral aclexplode(coalesce(o.acl,acldefault(o.typ,o.owner_oid))) a
  where o.identity in (${identities.map(o => q(o.identity)).join(',')})`
const defaultQuery = `select jsonb_build_array(d.defaclrole::regrole::text,coalesce(n.nspname,'<global>'),d.defaclobjtype::text,
  a.grantor::regrole::text,case when a.grantee=0 then 'PUBLIC' else a.grantee::regrole::text end,a.privilege_type,a.is_grantable)
  from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace cross join lateral aclexplode(d.defaclacl) a`
const platformRawQuery = `select distinct jsonb_build_array(d.defaclrole::regrole::text,
  coalesce(n.nspname,'<global>'),d.defaclobjtype::text,d.defaclacl::text)
  from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace
  where d.defaclrole=to_regrole('supabase_admin')`
const platformRaw = catalog.default_rows.filter(c => c.creator === 'supabase_admin')
  .map(c => [c.creator,c.schema,c.type,c.raw_acl])
const authorityQuery = `select jsonb_build_array(current_user,session_user,
  (select datdba::regrole::text from pg_database where datname=current_database()),
  pg_has_role(current_user,'pg_database_owner','USAGE'),pg_has_role(current_user,'pg_database_owner','SET'),
  has_schema_privilege(current_user,'public','CREATE'),has_schema_privilege(current_user,'public','USAGE'),
  has_database_privilege(current_user,current_database(),'CREATE'),
  has_database_privilege(current_user,current_database(),'CONNECT'),
  has_database_privilege(current_user,current_database(),'TEMPORARY'),
  coalesce(pg_has_role(current_user,to_regrole('supabase_admin'),'USAGE'),false),
  coalesce(pg_has_role(current_user,to_regrole('supabase_admin'),'SET'),false),
  current_setting('server_version_num'))`
const authority = [[catalog.operator.role,catalog.operator.session_role,catalog.database.owner,
  catalog.operator.pg_database_owner_usage,catalog.operator.pg_database_owner_set,
  catalog.operator.public_create,catalog.operator.public_usage,
  catalog.operator.database_create,catalog.operator.database_connect,catalog.operator.database_temporary,
  catalog.operator.supabase_admin_usage,catalog.operator.supabase_admin_set,String(catalog.server_version_num)]]
const databaseQuery = `select jsonb_build_array(datdba::regrole::text,datallowconn,datconnlimit)
  from pg_database where datname=current_database()`
const databaseState = [[catalog.database.owner,catalog.database.allow_connections,
  catalog.database.connection_limit]]
const databaseAclQuery = `select jsonb_build_array(a.grantor::regrole::text,
  case when a.grantee=0 then 'PUBLIC' else a.grantee::regrole::text end,a.privilege_type,a.is_grantable)
  from pg_database d cross join lateral aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a
  where d.datname=current_database()`
const schemaQuery = `select jsonb_build_array(nspname,nspowner::regrole::text)
  from pg_namespace where nspname in ('public','sync_private','collaboration_private','auth')`
const schemaAclQuery = `select jsonb_build_array(n.nspname,a.grantor::regrole::text,
  case when a.grantee=0 then 'PUBLIC' else a.grantee::regrole::text end,a.privilege_type,a.is_grantable)
  from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
  where n.nspname in ('public','sync_private','collaboration_private','auth')`
// Let PostgreSQL decode captured ACL text; no ad-hoc aclitem parser (quoted roles).
const capturedSchemaAclQuery = catalog.schemas.map(s => `select jsonb_build_array(${q(s.nspname)},
  a.grantor::regrole::text,case when a.grantee=0 then 'PUBLIC' else a.grantee::regrole::text end,
  a.privilege_type,a.is_grantable) v from aclexplode(coalesce(${s.raw_acl === null ? 'null' : q(s.raw_acl)}::aclitem[],
  acldefault('n',${q(s.owner)}::regrole))) a`).join(' union all ')
const columnQuery = `select jsonb_build_array(format('%I.%I',n.nspname,c.relname),a.attname,a.attacl::text)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  join pg_attribute a on a.attrelid=c.oid
  where n.nspname in ('public','sync_private','collaboration_private','auth')
    and c.relkind in ('r','p','v','m') and a.attnum>0 and not a.attisdropped`
const rolesQuery = `select jsonb_build_object('rolname',rolname,'rolsuper',rolsuper,'rolinherit',rolinherit,
  'rolcreaterole',rolcreaterole,'rolcreatedb',rolcreatedb,'rolcanlogin',rolcanlogin,
  'rolreplication',rolreplication,'rolbypassrls',rolbypassrls,'rolconnlimit',rolconnlimit) from pg_roles`
const membershipsQuery = `select jsonb_build_object('granted_role',p.rolname,'member',c.rolname,
  'grantor',g.rolname,'admin_option',m.admin_option,'inherit_option',m.inherit_option,'set_option',m.set_option)
  from pg_auth_members m join pg_roles p on p.oid=m.roleid join pg_roles c on c.oid=m.member
  join pg_roles g on g.oid=m.grantor`
const originalFunctionsQuery = `select jsonb_build_object(
  'identity',format('%I.%I(%s)',n.nspname,p.proname,oidvectortypes(p.proargtypes)),
  'source',p.prosrc,'owner',p.proowner::regrole::text,'security_definer',p.prosecdef,'config',p.proconfig)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where p.prokind='f' and n.nspname in ('public','sync_private','collaboration_private','auth')
    and p.oid is distinct from to_regprocedure(${q(reorder)})`
const originalFunctions = catalog.functions.map(({identity,source,owner,security_definer,config}) =>
  ({identity,source,owner,security_definer,config}))
const names = ['20261020005000_public_default_privilege_convergence.sql',
  '20261020010000_privilege_convergence.sql','20261020020000_atomic_itinerary_reorder.sql']
const sources = names.map(name => ({ name, sql: readFileSync(join(root,'supabase/migrations',name),'utf8') }))
const reorderSource = sources[2].sql.match(/as \$\$([\s\S]*?)\$\$;/)?.[1]
if (!reorderSource) throw new Error('Cannot identify reviewed reorder body')
let rollback = `-- PRIVATE, UNREHEARSED; NOT AUTHORIZATION FOR LIVE EXECUTION.
-- Restore captured grants only, never tables/data/owners/memberships.
begin;
set local search_path=pg_catalog;
set local lock_timeout='10s';
set local statement_timeout='60s';
select pg_advisory_xact_lock(741293,1);
`
const authorityGuards = compare(authorityQuery, authority, 'Recovery blocked: executor/database ownership/effective schema authority differs') +
  compare(databaseQuery, databaseState, 'Recovery blocked: database attributes/ACL differ') +
  compare(databaseAclQuery, catalog.database.acl.map(c => [c.grantor,c.grantee,c.privilege,c.is_grantable]), 'Recovery blocked: database ACL differs') +
  compare(schemaQuery, catalog.schemas.map(s => [s.nspname,s.owner]), 'Recovery blocked: schema owner differs') +
  `do $guard$ begin
    if (select jsonb_agg(v order by v) from (${schemaAclQuery}) s(v)) is distinct from
       (select jsonb_agg(v order by v) from (${capturedSchemaAclQuery}) s(v))
    then raise exception 'Recovery blocked: schema ACL differs'; end if;
  end $guard$;\n` +
  compare(columnQuery, catalog.columns.map(c => [c.table,c.name,c.raw_acl]), 'Recovery blocked: column ACL differs') +
  compare(originalFunctionsQuery, originalFunctions, 'Recovery blocked: original function source/owner/config differs') +
  compare(rolesQuery, catalog.roles, 'Recovery blocked: role attributes differ') +
  compare(membershipsQuery, catalog.memberships, 'Recovery blocked: memberships differ') +
  compare(platformRawQuery, platformRaw, 'Recovery blocked: untouched platform raw defaults differ')
rollback += authorityGuards
rollback += compare(aclQuery, targetCells.filter(c => !removedCell(c)).map(cellKey), 'Recovery blocked: object ACL/owner poststate differs')
rollback += compare(defaultQuery, catalog.defaults.filter(c => !removedDefault(c)).map(defaultKey), 'Recovery blocked: default ACL poststate differs')
rollback += `do $guard$ begin
  if not exists (select 1 from pg_proc where oid=to_regprocedure(${q(reorder)})
    and prosrc=${q(reorderSource)} and prosecdef and proconfig=array['search_path=""']
    and prorettype='void'::regtype and prokind='f' and proargmodes is null
    and provolatile='v' and not proisstrict and not proleakproof and proparallel='u'
    and prolang=(select oid from pg_language where lanname='plpgsql')
    and proowner::regrole::text=${q(catalog.operator.role)})
  then raise exception 'Recovery blocked: reorder source/owner/config differs'; end if;
end $guard$;
`
const reorderAclQuery = `select jsonb_build_array(a.grantor::regrole::text,
  case when a.grantee=0 then 'PUBLIC' else a.grantee::regrole::text end,a.privilege_type,a.is_grantable)
  from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  where p.oid=to_regprocedure(${q(reorder)})`
rollback += compare(reorderAclQuery, [['postgres','postgres','EXECUTE',false],
  ['postgres','authenticated','EXECUTE',false]], 'Recovery blocked: reorder ACL differs')
rollback += 'drop function public.app_reorder_itinerary_items(uuid,date,uuid[]);\n'
// Authority is the captured actual postgres operator, not an internal platform
// role. Never emit ALTER DEFAULT PRIVILEGES or SET ROLE for untouched platform cells.
for (const c of cells) rollback += `grant ${c.privilege} on ${c.kind === 'table' ? 'table' : 'function'} ${c.identity} to ${ident(c.grantee)};\n`
for (const c of defaults) rollback += `alter default privileges for role ${ident(c.creator)} in schema ${ident(c.schema)} grant ${c.privilege} on ${{r:'tables',S:'sequences',f:'functions'}[c.type]} to ${ident(c.grantee)};\n`
rollback += compare(aclQuery, targetCells.map(cellKey), 'Recovery failed: original object ACL/owner mismatch')
rollback += compare(defaultQuery, catalog.defaults.map(defaultKey), 'Recovery failed: original default ACL mismatch')
rollback += authorityGuards
rollback += 'commit;\n'
save('exact-recovery.UNREHEARSED.sql', rollback)
save('function-definitions.sql', catalog.functions.map(f => f.definition).join('\n'))
const summary = {
  convergence_scope: convergenceScope,
  ownership_evidence_required: true,
  captured_at: catalog.captured_at, directory,
  consistent_catalog_and_fingerprints: true, consistent_dump: consistentDump, full_backup: consistentDump,
  fingerprint_tables: fingerprints.length, object_acl_cells_to_restore: cells.length,
  default_acl_cells_to_restore: defaults.length,
  retained_platform_default_cells: catalog.defaults.filter(c => c.creator === 'supabase_admin').length,
  preserved_trip_column_acls: catalog.columns.filter(c => c.table==='public.trips' && c.raw_acl!==null).length,
  platform_creator_accessible: catalog.operator.supabase_admin_usage || catalog.operator.supabase_admin_set,
  recovery_prepared: true, recovery_rehearsed: false, live_installation: false,
  recovery_sha256: createHash('sha256').update(rollback).digest('hex'),
  sources: sources.map(({name,sql}) => ({name,sha256:createHash('sha256').update(sql).digest('hex')})),
  rollback_sources: names.map(name => ({name,sha256:createHash('sha256')
    .update(readFileSync(join(root,'supabase/rollback',name))).digest('hex')})),
  capture_sources: ['scripts/convergence-capture.mjs','scripts/convergence-capture.sql','scripts/convergence-scope.mjs']
    .map(name => ({name,sha256:createHash('sha256').update(readFileSync(join(root,name))).digest('hex')})),
  limitations: ['Not a data dump; fingerprints cannot restore data.',
    'Recovery is unexecuted; raw ACL ordering/NULL and full receipts remain unverified.',
    'Platform defaults are retained exactly; future platform-created objects require explicit ACL review.',
    'Fresh ownership/effective rights evidence and separately approved isolated rehearsal/install are required.'],
}
save('receipt.json', JSON.stringify(summary,null,2)+'\n')
// Only counts and status, never object identities, source, row hashes or data.
if (!consistentDump) console.log(JSON.stringify({ convergence_scope: convergenceScope,
  recovery_prepared: true, recovery_rehearsed: false, live_installation: false,
  object_acl_cells_to_restore: cells.length, default_acl_cells_to_restore: defaults.length,
  retained_platform_default_cells: summary.retained_platform_default_cells },null,2))
return summary
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()