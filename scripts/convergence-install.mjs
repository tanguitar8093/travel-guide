// Explicitly authorized live installation only. Never invoked by backup/test tooling.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertDefaultScope, assertOwnershipEvidence } from './convergence-scope.mjs'

process.umask(0o077)
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const base = join(homedir(), '.local/state/travel-guide-backups')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const readJSON = path => JSON.parse(readFileSync(path, 'utf8'))
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
const sorted = values => [...values].map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
const records = text => text.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line))
const catalogOf = rows => rows.find(row => row.kind === 'catalog')
const protectedCatalog = ({ captured_at, snapshot, ...catalog }) => catalog
const quote = value => `'${String(value).replaceAll("'", "''")}'`
const names = ['20261020005000_public_default_privilege_convergence.sql',
  '20261020010000_privilege_convergence.sql', '20261020020000_atomic_itinerary_reorder.sql']
let directory
let status = { live_installation: false, committed: [], verification: 'not started' }
const save = (name, value) => writeFileSync(join(directory, name), value, { mode: 0o600, flag: 'wx' })
function requireTrue(condition, message) { if (!condition) throw new Error(message) }

try {
  requireTrue(process.argv[2] === '--authorized-live-install' && process.argv[3], 'Explicit installation flag and frozen archive required')
  const archive = resolve(process.argv[3])
  requireTrue(dirname(archive) === base && (statSync(archive).mode & 0o777) === 0o700, 'Invalid private archive')
  const receipt = readJSON(join(archive, 'receipt.json'))
  const backup = readJSON(join(archive, 'backup-status.json'))
  const frozen = readJSON(join(archive, 'source-hashes.json'))
  const checkFrozen = () => {
    requireTrue(frozen.every(e => sha(readFileSync(join(root, e.name))) === e.sha256), 'Frozen source mismatch')
    requireTrue(backup.evidence_hashes.every(e => sha(readFileSync(join(archive, e.name))) === e.sha256), 'Frozen evidence mismatch')
    requireTrue(sha(readFileSync(join(archive, 'application-auth.dump'))) === backup.archive_sha256 &&
      sha(readFileSync(join(archive, 'exact-recovery.UNREHEARSED.sql'))) === receipt.recovery_sha256, 'Frozen backup/recovery mismatch')
  }
  checkFrozen()
  requireTrue(backup.consistent_dump && backup.snapshot_exported_and_shared && backup.full_backup, 'Consistent full backup required')
  const rehearsal = readdirSync(archive).filter(n => n.startsWith('rehearsal-')).map(n => join(archive, n))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
  requireTrue(rehearsal, 'Successful isolated rehearsal required')
  const rehearsalStatus = readJSON(join(rehearsal, 'rehearsal-status.json'))
  const attestation = readJSON(join(rehearsal, 'recovery-rehearsal-attestation.json'))
  requireTrue(!rehearsalStatus.blocker && rehearsalStatus.cluster_stopped && rehearsalStatus.network_isolated &&
    rehearsalStatus.exact_migration_acl_and_owners && rehearsalStatus.isolated_operator_authority_verified &&
    rehearsalStatus.retained_platform_defaults_raw_exact && rehearsalStatus.recovery_roles_exact &&
    rehearsalStatus.recovery_receipt_fingerprints_exact && rehearsalStatus.foreign_key_violations === 0 &&
    attestation.candidate_sha256 === receipt.recovery_sha256 && attestation.candidate_unchanged &&
    attestation.equivalent_operator_only && attestation.isolated_authority_verified &&
    same(attestation.sources, receipt.sources) &&
    Object.entries(rehearsalStatus.recovery_comparison).every(([key, value]) =>
      ['fingerprint_tables', 'fingerprint_matches'].includes(key) || value === true), 'Rehearsal/attestation guard failed')
  const archived = records(readFileSync(join(archive, 'preinstall.jsonl'), 'utf8'))
  const original = catalogOf(archived)
  assertOwnershipEvidence(original)
  assertDefaultScope(original)
  mkdirSync(base, { recursive: true, mode: 0o700 })
  directory = mkdtempSync(join(base, 'convergence-live-install-'))
  status = { ...status, started_at: new Date().toISOString(), archive, rehearsal,
    authorization: 'User explicitly approved three incremental migrations and result verification',
    transaction_model: 'Three unchanged sources, separate original transactions; stop on first error',
    source_hashes: receipt.sources, installation_driver_sha256: sha(readFileSync(fileURLToPath(import.meta.url))),
    operator: original.operator, recovery_executed: false }
  const capture = readFileSync(join(root, 'scripts/convergence-capture.sql'), 'utf8')
  const catalogQuery = capture.slice(capture.indexOf('with schemas as ('), capture.indexOf('-- Same repeatable-read')).trim().replace(/;$/, '')
  requireTrue(catalogQuery.startsWith('with schemas as (') && catalogQuery.endsWith('::jsonb::text'), 'Capture query boundaries unrecognized')
  const sources = names.map(name => {
    const sql = readFileSync(join(root, 'supabase/migrations', name), 'utf8')
    requireTrue(receipt.sources.some(e => e.name === name && e.sha256 === sha(sql)), 'Approved migration source mismatch')
    save(name, sql)
    return sql
  })
  // Session lock survives the unchanged individual BEGIN/COMMIT boundaries.
  // Exact catalog guard runs after acquiring it; fingerprints are a fresh baseline,
  // not an assumption that business/auth rows stayed static since the backup.
  const sql = `set statement_timeout='120s';
set lock_timeout='10s';
set timezone='UTC';
set extra_float_digits=0;
select pg_catalog.pg_advisory_lock(741293,1);
begin read only;
set local search_path=pg_catalog;
do $install_guard$ declare actual jsonb; begin
  select (${catalogQuery})::jsonb into actual;
  if actual - 'captured_at' - 'snapshot' is distinct from ${quote(JSON.stringify(protectedCatalog(original)))}::jsonb
  then raise exception 'Installation blocked: live catalog differs from freshly rehearsed backup'; end if;
end $install_guard$;
commit;
\\echo BEFORE_CAPTURE
${capture}
\\echo BEFORE_CAPTURE_END
${sources.map((source, i) => `${source}\n\\echo COMMITTED:${names[i]}`).join('\n')}
\\echo AFTER_CAPTURE
${capture}
\\echo AFTER_CAPTURE_END
begin read only;
select jsonb_build_object('kind','rpc_access',
  'authenticated',has_function_privilege('authenticated','public.app_reorder_itinerary_items(uuid,date,uuid[])','EXECUTE'),
  'anon',has_function_privilege('anon','public.app_reorder_itinerary_items(uuid,date,uuid[])','EXECUTE'),
  'service_role',has_function_privilege('service_role','public.app_reorder_itinerary_items(uuid,date,uuid[])','EXECUTE'))::text;
commit;
select pg_catalog.pg_advisory_unlock(741293,1);
`
  save('install-package.private.sql', sql)
  save('pre-install-status.json', JSON.stringify(status, null, 2))
  checkFrozen()
  const out = openSync(join(directory, 'installation.stdout.private.log'), 'wx', 0o600)
  const err = openSync(join(directory, 'installation.stderr.private.log'), 'wx', 0o600)
  let result
  try {
    status.live_installation = true
    result = spawnSync(process.execPath, [join(root, 'scripts/db-psql.mjs'), '-At', '-f', join(directory, 'install-package.private.sql')], {
      cwd: root, env: { ...process.env, PGAPPNAME: 'travel-authorized-convergence-install' }, stdio: ['ignore', out, err],
    })
  } finally { closeSync(out); closeSync(err) }
  const output = readFileSync(join(directory, 'installation.stdout.private.log'), 'utf8')
  status.committed = names.filter(name => output.split('\n').includes(`COMMITTED:${name}`))
  requireTrue(result.status === 0 && status.committed.length === 3, 'Installation stopped; inspect private logs and committed steps; recovery not automatically executed')
  const section = (start, end) => {
    requireTrue(output.includes(start) && output.includes(end), 'Missing capture markers')
    return output.split(start + '\n')[1].split(end)[0]
  }
  const beforeText = section('BEFORE_CAPTURE', 'BEFORE_CAPTURE_END')
  const afterText = section('AFTER_CAPTURE', 'AFTER_CAPTURE_END')
  save('before-install.jsonl', beforeText)
  save('after-install.jsonl', afterText)
  const before = records(beforeText), after = records(afterText)
  const a = catalogOf(before), b = catalogOf(after)
  assertOwnershipEvidence(b)
  assertDefaultScope(b)
  requireTrue(same(protectedCatalog(original), protectedCatalog(a)), 'Locked preinstallation catalog mismatch')
  const normalize = s => s.replaceAll(', ', ',')
  const tables = new Set(['regions','labels','places','place_regions','place_labels','trips','itinerary_items','route_maps','route_map_places','user_roles'].map(n => `public.${n}`))
  const helpers = new Set(['app_backup_preview_clear()','app_backup_apply_clear(text)','app_backup_account_counts(uuid)',
    'app_backup_has_shared_trip(uuid)','app_backup_account_signature(uuid)','app_backup_assert_payload(jsonb)',
    'app_backup_preview_replace(jsonb)','app_backup_apply_replace(jsonb,text)','can_manage_trip_acl(uuid)'].map(n => `public.${n}`))
  const triggers = new Set(['public.assign_private_record_owner()', 'public.assign_route_map_record_owner()'])
  const removed = c => (c.kind === 'table' && tables.has(c.identity) &&
    ((c.grantee === 'authenticated' && ['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'].includes(c.privilege)) ||
      (c.identity === 'public.user_roles' && c.grantee === 'anon'))) ||
    (c.kind === 'function' && ((c.grantee === 'anon' && helpers.has(normalize(c.identity))) ||
      (['anon','authenticated'].includes(c.grantee) && triggers.has(normalize(c.identity)))))
  const reorder = 'public.app_reorder_itinerary_items(uuid, date, uuid[])'
  const expectedCells = a.cells.filter(c => !removed(c)).concat(['postgres','authenticated'].map(grantee =>
    ({ kind: 'function', identity: reorder, owner: 'postgres', grantor: 'postgres', grantee, privilege: 'EXECUTE', is_grantable: false })))
  const semanticDefaults = rows => sorted(rows.map(({ oid, raw_acl, ...cell }) => cell))
  const expectedDefaults = a.defaults.filter(c => !(c.creator === 'postgres' && c.schema === 'public' && ['anon','authenticated'].includes(c.grantee)))
  const newFunction = b.functions.find(f => f.identity === reorder)
  const rehearsedFunction = catalogOf(records(readFileSync(join(rehearsal, 'after-operator-migrations.jsonl'), 'utf8'))).functions.find(f => f.identity === reorder)
  const protectedKeys = ['database','operator','server_version_num','convergence_scope','schemas','roles','memberships',
    'columns','constraints','triggers','indexes','policies','row_security']
  const fingerprintsA = before.filter(r => r.kind === 'fingerprint')
  const fingerprintsB = after.filter(r => r.kind === 'fingerprint')
  const access = records(output).find(r => r.kind === 'rpc_access')
  const checks = {
    protected_catalog_exact: protectedKeys.every(key => same(a[key], b[key])),
    exact_acl_cells: same(sorted(expectedCells), sorted(b.cells)),
    exact_default_cells: same(semanticDefaults(expectedDefaults), semanticDefaults(b.defaults)),
    retained_platform_raw_defaults_exact: same(a.default_rows.filter(d => d.creator === 'supabase_admin'), b.default_rows.filter(d => d.creator === 'supabase_admin')),
    exact_objects: same(sorted(a.objects.concat({ kind: 'function', identity: reorder, owner: 'postgres' }).map(({kind,identity,owner}) => ({kind,identity,owner}))), sorted(b.objects.map(({kind,identity,owner}) => ({kind,identity,owner})))),
    original_functions_exact: same(a.functions, b.functions.filter(f => f.identity !== reorder)),
    new_function_exact_rehearsed: !!newFunction && same(newFunction, rehearsedFunction),
    rpc_effective_access_exact: same(access, { kind: 'rpc_access', authenticated: true, anon: false, service_role: false }),
    fingerprints_exact: same(fingerprintsA, fingerprintsB),
  }
  status.checks = checks
  status.fingerprint_tables = fingerprintsA.length
  status.fingerprint_matches = fingerprintsA.filter(f => fingerprintsB.some(g => same(f,g))).length
  status.foreign_key_definitions_checked = a.constraints.filter(c => c.definition.startsWith('FOREIGN KEY')).length
  status.memberships_checked = a.memberships.length
  status.retained_platform_default_cells = b.defaults.filter(c => c.creator === 'supabase_admin').length
  status.object_acl_cells_removed = a.cells.filter(removed).length
  status.default_acl_cells_removed = a.defaults.length - expectedDefaults.length
  status.backup_to_preinstall_fingerprint_drift_tables = fingerprintsA.filter(f => !archived.some(g => same(f,g))).length
  requireTrue(Object.entries(checks).every(([key,value]) => key === 'fingerprints_exact' || value), 'Postinstallation catalog verification failed; private evidence retained, no automatic recovery')
  status.verification = checks.fingerprints_exact ? 'passed' : 'catalog passed; concurrent row drift requires review'
  status.completed_at = new Date().toISOString()
  save('installation-receipt.json', JSON.stringify(status, null, 2))
  console.log(JSON.stringify({ directory, committed: status.committed, verification: status.verification,
    checks, fingerprint_tables: status.fingerprint_tables, fingerprint_matches: status.fingerprint_matches,
    foreign_key_definitions_checked: status.foreign_key_definitions_checked, memberships_checked: status.memberships_checked,
    retained_platform_default_cells: status.retained_platform_default_cells,
    object_acl_cells_removed: status.object_acl_cells_removed, default_acl_cells_removed: status.default_acl_cells_removed,
    backup_to_preinstall_fingerprint_drift_tables: status.backup_to_preinstall_fingerprint_drift_tables,
    recovery_executed: false }, null, 2))
} catch {
  status.verification = 'blocked or incomplete; inspect private evidence before any retry'
  if (directory) save('installation-failure-status.json', JSON.stringify(status, null, 2))
  console.error(JSON.stringify({ directory, live_installation: status.live_installation, committed: status.committed,
    verification: status.verification, recovery_executed: false }))
  process.exitCode = 1
}