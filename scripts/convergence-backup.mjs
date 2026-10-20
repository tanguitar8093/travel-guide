// Authorized READ ONLY live backup; all writes/rehearsals are private and isolated.
// Invoke with node --env-file=.env.local scripts/convergence-backup.mjs.
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readlinkSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareCapturedEvidence } from './convergence-capture.mjs'
import { assertDefaultScope, assertOwnershipEvidence, convergenceScope } from './convergence-scope.mjs'

process.umask(0o077)
const self = fileURLToPath(import.meta.url)
const root = dirname(dirname(self))
const tools = join(homedir(), '.local/opt/travel-pg17')
const runner = join(tools, 'pg17-run')
const scopes = ['public', 'sync_private', 'collaboration_private', 'auth']
const migrationNames = ['20261020005000_public_default_privilege_convergence.sql',
  '20261020010000_privilege_convergence.sql', '20261020020000_atomic_itinerary_reorder.sql']
const frozenSourceNames = ['scripts/convergence-backup.mjs', 'scripts/convergence-capture.mjs',
  'scripts/convergence-capture.sql', 'scripts/convergence-scope.mjs',
  ...['migrations', 'rollback'].flatMap(folder => migrationNames.map(name => `supabase/${folder}/${name}`))]
const quote = value => `'${String(value).replaceAll("'", "''")}'`
const ident = value => `"${String(value).replaceAll('"', '""')}"`
const sha = value => createHash('sha256').update(value).digest('hex')
const cleanEnv = () => ({ PATH: '/usr/bin:/bin', HOME: homedir(), LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' })
let directory
let secrets = []
const redact = text => secrets.reduce((s, secret) => s.replaceAll(secret, '[redacted]'), String(text))
const save = (name, data) => writeFileSync(join(directory, existsSync(join(directory, name)) ? `${name}.${process.pid}` : name), data, { mode: 0o600, flag: 'wx' })
const json = name => JSON.parse(readFileSync(join(directory, name), 'utf8'))
function run(binary, args, env, { input, log, allowFailure = false } = {}) {
  const result = spawnSync(runner, [binary, ...args], {
    env, input, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, cwd: directory,
  })
  // Database diagnostics may contain private rows; never send them to the terminal.
  if (log) save(log, redact((result.stdout || '') + (result.stderr || '')))
  if (result.status !== 0 && !allowFailure) throw new Error(`${binary} failed; see private ${log || 'diagnostics'}`)
  return result
}
const psql = (sql, env, options) => run('psql', ['-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1'], env, { input: sql, ...options })
const parseLines = text => text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
const metadataSQL = `select jsonb_build_object(
  'kind','dependencies',
  'extensions',(select jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,
    'schema',n.nspname,'schema_owner',n.nspowner::regrole::text,'owner',e.extowner::regrole::text))
    from pg_extension e join pg_namespace n on n.oid=e.extnamespace),
  'sequences',(select jsonb_agg(jsonb_build_object('identity',format('%I.%I',n.nspname,c.relname),
    'owner',c.relowner::regrole::text,'acl',c.relacl::text)) from pg_class c
    join pg_namespace n on n.oid=c.relnamespace where c.relkind='S'
    and n.nspname in ('public','sync_private','collaboration_private','auth')),
  'role_connection_limits',(select jsonb_object_agg(rolname,rolconnlimit) from pg_roles),
  'outside_dependencies',(select jsonb_agg(distinct pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid))
    from pg_depend d join pg_class c on d.classid='pg_class'::regclass and d.objid=c.oid
    join pg_namespace n on c.relnamespace=n.oid
    where n.nspname in ('public','sync_private','collaboration_private','auth')
    and d.refclassid='pg_proc'::regclass)
)::text;`

async function exportSnapshot(env) {
  const child = spawn(runner, ['psql', '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
    env, cwd: directory, stdio: ['pipe', 'pipe', 'pipe'],
  })
  let output = ''
  let errors = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', data => { errors += data })
  const closed = new Promise(resolveClose => {
    child.on('error', () => resolveClose(-1))
    child.on('close', code => resolveClose(code))
  })
  const snapshot = await new Promise((resolveSnapshot, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Snapshot export timed out')) }, 30000)
    child.stdout.on('data', data => {
      output += data
      const match = output.match(/SNAPSHOT:([0-9A-Fa-f-]+)\n/)
      if (match) { clearTimeout(timer); resolveSnapshot(match[1]) }
    })
    closed.then(() => { clearTimeout(timer); reject(new Error('Snapshot export session ended')) })
    child.stdin.on('error', () => {})
    child.stdin.write(`begin isolation level repeatable read read only;
set local statement_timeout='120s';
set local lock_timeout='10s';
select 'SNAPSHOT:' || pg_export_snapshot();\n`)
  })
  return { snapshot, async finish() {
    child.stdin.end('rollback;\n')
    const status = await closed
    save('snapshot-session.log', redact(errors))
    if (status !== 0) throw new Error('Snapshot holder failed')
  } }
}

async function backup() {
  const raw = process.env.SUPABASE_DB_URL
  if (!raw) throw new Error('SUPABASE_DB_URL missing; use node --env-file')
  // Parsing failures are caught without printing the URL or Error object.
  let url
  try { url = new URL(raw) } catch { throw new Error('Invalid database URL; contents omitted') }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Invalid database URL protocol')
  const env = { ...cleanEnv(), PGHOST: url.hostname, PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGSSLMODE: url.searchParams.get('sslmode') || 'require',
    PGCONNECT_TIMEOUT: '15', PGAPPNAME: 'travel-convergence-readonly-backup',
    PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=120000 -c lock_timeout=10000',
  }
  secrets = [raw, url.hostname, env.PGPASSWORD, url.password].filter(Boolean)
  const base = join(homedir(), '.local/state/travel-guide-backups')
  mkdirSync(base, { recursive: true, mode: 0o700 })
  chmodSync(base, 0o700)
  directory = mkdtempSync(join(base, 'convergence-backup-'))
  save('source-hashes.json', JSON.stringify(frozenSourceNames.map(name =>
    ({ name, sha256: sha(readFileSync(join(root, name))) })), null, 2))
  const holder = await exportSnapshot(env)
  let dumpOK = false
  try {
    const capture = run('psql', ['-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1',
      '-v', `capture_snapshot=${holder.snapshot}`, '-f', join(root, 'scripts/convergence-capture.sql')], env,
    { log: 'capture-diagnostics.private.log' })
    save('preinstall.jsonl', capture.stdout)
    const dependencies = psql(`begin isolation level repeatable read read only;
set transaction snapshot ${quote(holder.snapshot)};\n${metadataSQL}\nrollback;`, env,
    { log: 'dependency-diagnostics.private.log' })
    save('dependencies.json', dependencies.stdout.trim())
    run('pg_dump', ['-w', '--format=custom', '--compress=6', '--lock-wait-timeout=10000',
      `--snapshot=${holder.snapshot}`, ...scopes.map(s => `--schema=${s}`),
      '--file', join(directory, 'application-auth.dump')], env, { log: 'dump.private.log' })
    chmodSync(join(directory, 'application-auth.dump'), 0o600)
    run('pg_restore', ['--list', join(directory, 'application-auth.dump')], cleanEnv(), { log: 'archive-list.private.log' })
    const receipt = prepareCapturedEvidence(directory, true)
    save('backup-status.json', JSON.stringify({
      ...receipt, snapshot_exported_and_shared: true, backup_scope: scopes, platform_backup: false,
      archive_sha256: sha(readFileSync(join(directory, 'application-auth.dump'))),
      evidence_hashes: ['preinstall.jsonl', 'dependencies.json', 'source-hashes.json', 'receipt.json']
        .map(name => ({ name, sha256: sha(readFileSync(join(directory, name))) })),
      sequence_state_mvcc: false, live_writes: false,
    }, null, 2))
    dumpOK = true
  } finally { await holder.finish() }
  if (!dumpOK) return
  // Never inherit the live URL/password or any project environment into isolation.
  const isolated = spawnSync('unshare', ['--user', '--map-current-user', '--net',
    process.execPath, self, '--isolated', directory], {
    env: { ...cleanEnv(), PG17_HOST_NETNS: readlinkSync('/proc/self/ns/net') },
    cwd: directory, encoding: 'utf8', maxBuffer: 1024 * 1024,
  })
  save('isolation-driver.private.log', redact((isolated.stdout || '') + (isolated.stderr || '')))
  if (isolated.status !== 0) throw new Error('Isolated rehearsal incomplete; private evidence preserved')
  // The child emits only the safe summary, including the latest retry status.
  process.stdout.write(isolated.stdout)
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]))
  return value
}
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
const sortedCells = values => [...(values || [])].sort((a,b) =>
  JSON.stringify(canonical(a)).localeCompare(JSON.stringify(canonical(b))))
function compareCaptures(before, after) {
  const a = before.find(r => r.kind === 'catalog')
  const b = after.find(r => r.kind === 'catalog')
  const fingerprintsA = before.filter(r => r.kind === 'fingerprint')
  const fingerprintsB = after.filter(r => r.kind === 'fingerprint')
  const matched = fingerprintsA.filter(row => fingerprintsB.some(other => same(row, other))).length
  const strip = (values, keys) => (values || []).map(v => Object.fromEntries(Object.entries(v).filter(([k]) => !keys.includes(k))))
  // pg_dump does not preserve dropped-column attnum gaps or ACL array order;
  // explicit owner-only ACL and NULL acldefault are semantically equivalent.
  const acl = (raw, owner, schema = false) => (raw === null
    ? [`${owner}=${schema ? 'UC' : 'arwdDxtm'}/${owner}`]
    : raw.slice(1, -1).split(',')).sort()
  const objectACL = values => values.map(o => ({ ...o, oid: undefined, raw_acl: acl(o.raw_acl, o.owner) }))
  const schemaACL = values => values.map(o => ({ ...o, oid: undefined, raw_acl: acl(o.raw_acl, o.owner, true) }))
  const defaultCells = values => strip(values, ['oid','raw_acl']).sort((x,y) => JSON.stringify(x).localeCompare(JSON.stringify(y)))
  const databaseContext = c => ({ ...c.database, raw_acl: undefined, acl: sortedCells(c.database.acl) })
  const checks = {
    database_ownership: same(databaseContext(a), databaseContext(b)),
    effective_operator: same(a.operator, b.operator),
    server_version_exact: a.server_version_num === b.server_version_num,
    convergence_scope: a.convergence_scope === convergenceScope && b.convergence_scope === convergenceScope,
    fingerprint_tables: fingerprintsA.length, fingerprint_matches: matched,
    fingerprint_exact: matched === fingerprintsA.length && fingerprintsB.length === fingerprintsA.length,
    object_owners_and_acl: same(objectACL(a.objects), objectACL(b.objects)),
    schema_owners_and_acl: same(schemaACL(a.schemas), schemaACL(b.schemas)),
    effective_object_acl: same(sortedCells(a.cells), sortedCells(b.cells)),
    default_acl: same(defaultCells(a.defaults), defaultCells(b.defaults)),
    retained_platform_raw_defaults: same(
      sortedCells(a.default_rows.filter(d => d.creator === 'supabase_admin')),
      sortedCells(b.default_rows.filter(d => d.creator === 'supabase_admin'))),
    columns: same(strip(a.columns, ['number']), strip(b.columns, ['number'])), constraints: same(a.constraints, b.constraints),
    triggers: same(a.triggers, b.triggers), indexes: same(a.indexes, b.indexes),
    policies: same(a.policies, b.policies), row_security: same(a.row_security, b.row_security),
    functions: same(a.functions, b.functions),
  }
  return checks
}

function isolated() {
  directory = resolve(process.argv[3])
  if (!directory.startsWith(join(homedir(), '.local/state/travel-guide-backups/convergence-backup-')) ||
      (statSync(directory).mode & 0o777) !== 0o700) throw new Error('Invalid private evidence directory')
  if (process.getuid() !== 1000 || process.geteuid() === 0) throw new Error('Must remain actual non-root uid1000')
  if (!process.env.PG17_HOST_NETNS || readlinkSync('/proc/self/ns/net') === process.env.PG17_HOST_NETNS)
    throw new Error('Network namespace not isolated')
  const interfaces = readFileSync('/proc/self/net/dev', 'utf8').split('\n').slice(2)
    .filter(line => line.includes(':')).map(line => line.split(':')[0].trim())
  if (!same(interfaces, ['lo']) || readFileSync('/proc/self/net/route', 'utf8').split('\n')
    .some(line => line.trim() && !line.startsWith('Iface'))) throw new Error('Network interfaces/routes not isolated')
  // Keep immutable archival inputs separate from every fresh rehearsal's outputs.
  const archiveDirectory = directory
  const archivalHashes = json('source-hashes.json')
  const backupStatus = json('backup-status.json')
  const receipt = json('receipt.json')
  const evidenceNames = ['preinstall.jsonl', 'dependencies.json', 'source-hashes.json', 'receipt.json']
  if (!Array.isArray(backupStatus.evidence_hashes) ||
      !same(backupStatus.evidence_hashes.map(e => e.name).sort(), [...evidenceNames].sort()) ||
      backupStatus.evidence_hashes.some(e => sha(readFileSync(join(directory, e.name))) !== e.sha256))
    throw new Error('Fresh separately authorized backup required: frozen ownership/catalog evidence missing or changed')
  const archivedCatalog = parseLines(readFileSync(join(directory, 'preinstall.jsonl'), 'utf8'))
    .find(r => r.kind === 'catalog')
  assertOwnershipEvidence(archivedCatalog)
  assertDefaultScope(archivedCatalog)
  if (receipt.convergence_scope !== convergenceScope || backupStatus.convergence_scope !== convergenceScope ||
      !same([...archivalHashes.map(e => e.name)].sort(), [...frozenSourceNames].sort()) ||
      !same([...(receipt.sources || []).map(e => e.name)].sort(), [...migrationNames].sort()) ||
      !same([...(receipt.rollback_sources || []).map(e => e.name)].sort(), [...migrationNames].sort()) ||
      !same([...(receipt.capture_sources || []).map(e => e.name)].sort(),
        ['scripts/convergence-capture.mjs','scripts/convergence-capture.sql','scripts/convergence-scope.mjs'].sort()))
    throw new Error('Fresh approved capture required; old scope archives cannot be upgraded or regenerated')
  const tooling = new Set() // Scope/ownership tooling is part of the frozen evidence contract.
  const sourceComparison = archivalHashes.map(entry => ({ ...entry,
    current_sha256: sha(readFileSync(join(root, entry.name))), tooling_revision: tooling.has(entry.name) }))
  if (sourceComparison.some(e => !e.tooling_revision && e.sha256 !== e.current_sha256) ||
      receipt.sources.some(e => sha(readFileSync(join(root, 'supabase/migrations', e.name))) !== e.sha256) ||
      receipt.rollback_sources.some(e => sha(readFileSync(join(root, 'supabase/rollback', e.name))) !== e.sha256) ||
      !receipt.capture_sources?.length || receipt.capture_sources.some(e =>
        sha(readFileSync(join(root, e.name))) !== e.sha256) ||
      sha(readFileSync(join(directory, 'exact-recovery.UNREHEARSED.sql'))) !== receipt.recovery_sha256 ||
      sha(readFileSync(join(directory, 'application-auth.dump'))) !== backupStatus.archive_sha256 ||
      !backupStatus.snapshot_exported_and_shared || !backupStatus.consistent_dump)
    throw new Error('Frozen archive/source guard failed; no overrides allowed')
  directory = mkdtempSync(join(archiveDirectory, 'rehearsal-'))
  for (const name of ['application-auth.dump', 'preinstall.jsonl', 'dependencies.json', 'source-hashes.json',
    'receipt.json', 'backup-status.json', 'exact-recovery.UNREHEARSED.sql'])
    save(name, readFileSync(join(archiveDirectory, name)))
  save('archival-source-comparison.json', JSON.stringify(sourceComparison, null, 2))
  save('frozen-input-hashes.json', JSON.stringify(['application-auth.dump', 'preinstall.jsonl', 'dependencies.json',
    'exact-recovery.UNREHEARSED.sql', 'receipt.json'].map(name => ({ name,
    sha256: sha(readFileSync(join(directory, name))) })), null, 2))
  // Unix socket paths are limited to approximately 107 bytes on Linux.
  const work = mkdtempSync(join(tmpdir(), 'travel-pg17-'))
  const data = join(work, 'data')
  const socket = join(work, 'socket')
  mkdirSync(socket, { mode: 0o700 })
  // PG17 requires explicit grantors to hold ADMIN; the original superuser
  // grantor is the synthetic cluster bootstrap itself, not a temporary grant
  // chain whose cleanup could cascade away the captured memberships.
  const bootstrap = 'supabase_admin'
  const env = { ...cleanEnv(), PGHOST: socket, PGPORT: '55437', PGUSER: bootstrap,
    PGDATABASE: 'postgres', PGSSLMODE: 'disable', PGCONNECT_TIMEOUT: '10',
    PGOPTIONS: '-c timezone=UTC -c extra_float_digits=0 -c datestyle=ISO,MDY -c intervalstyle=postgres' }
  const status = { archive_directory: archiveDirectory, live_writes: false, network_isolated: true, uid: process.getuid(), tcp_disabled: true,
    frozen_archive_and_migration_sources_verified: true, archival_vs_rehearsal_tooling_separated: true,
    archive_list_validated: false, restore: 'not completed', migration_operator: 'not run',
    convergence_scope: convergenceScope, recovery: 'not run', isolated_operator_authority_verified: false }
  save('rehearsal-source-hashes.json', JSON.stringify([
    self, join(root, 'scripts/convergence-capture.mjs'), join(root, 'scripts/convergence-capture.sql'),
    join(root, 'scripts/convergence-scope.mjs'),
  ].map(path => ({ name: path.slice(root.length + 1), sha256: sha(readFileSync(path)) })), null, 2))
  try {
    run('pg_restore', ['--list', join(directory, 'application-auth.dump')], cleanEnv(), { log: 'archive-list.private.log' })
    status.archive_list_validated = true
    run('initdb', ['-D', data, '-L', join(tools, 'root/usr/share/postgresql/17'),
      '--locale=C.UTF-8', '--encoding=UTF8', `--username=${bootstrap}`,
      '--auth-local=trust', '--auth-host=reject'], cleanEnv(), { log: 'initdb.private.log' })
    const log = join(work, 'server.private.log')
    closeSync(openSync(log, 'wx', 0o600))
    run('pg_ctl', ['-D', data, '-l', log, '-o',
      `-c listen_addresses='' -c unix_socket_directories='${socket}' -c unix_socket_permissions=0700 -c port=55437 -c ssl=off -c jit=off -c shared_preload_libraries=''`,
      '-w', '-t', '30', 'start'], cleanEnv(), { log: 'server-start.private.log' })
    const config = psql(`select jsonb_build_object('listen',current_setting('listen_addresses'),
      'sockets',current_setting('unix_socket_directories'),'data',current_setting('data_directory'),
      'version',current_setting('server_version_num'))::text;`, env).stdout
    const actual = JSON.parse(config)
    if (actual.listen !== '' || actual.sockets !== socket || actual.data !== data || Number(actual.version) < 170000)
      throw new Error('Unexpected server configuration')
    const before = parseLines(readFileSync(join(directory, 'preinstall.jsonl'), 'utf8'))
    const catalog = before.find(r => r.kind === 'catalog')
    const dependencies = json('dependencies.json')
    // Synthetic trusted roles: attributes/memberships only, never password hashes/config secrets.
    // ALTER DEFAULT PRIVILEGES canonicalizes by grantee OID, regardless of
    // GRANT order. Reproduce the fresh inventory's relative grantee order at
    // role creation; raw-exact verification below remains mandatory.
    const platformGranteeOrder = ['postgres', 'anon', 'authenticated', 'service_role', 'dashboard_user']
    const roleRank = r => {
      const rank = platformGranteeOrder.indexOf(r.rolname)
      return rank < 0 ? platformGranteeOrder.length : rank
    }
    const roles = catalog.roles.filter(r => !r.rolname.startsWith('pg_'))
      .sort((a, b) => roleRank(a) - roleRank(b) || a.rolname.localeCompare(b.rolname))
    if (roles.some(r => r.rolname === 'rehearsal_admin')) throw new Error('Bootstrap role collision')
    if (!roles.find(r => r.rolname === bootstrap)?.rolsuper ||
        catalog.memberships.some(m => m.grantor !== bootstrap))
      throw new Error('Original grantor graph requires separately reviewed synthetic authority')
    let roleSQL = roles.map(r => `${r.rolname === bootstrap ? 'alter' : 'create'} role ${ident(r.rolname)} with ${[
      ['rolsuper','SUPERUSER'],['rolinherit','INHERIT'],['rolcreaterole','CREATEROLE'],['rolcreatedb','CREATEDB'],
      ['rolcanlogin','LOGIN'],['rolreplication','REPLICATION'],['rolbypassrls','BYPASSRLS'],
    ].map(([key, keyword]) => `${r[key] ? '' : 'NO'}${keyword}`).join(' ')}
      connection limit ${Number(dependencies.role_connection_limits[r.rolname])};`).join('\n')
    // PG17 otherwise attributes superuser grants to the bootstrap superuser.
    // Explicit GRANTED BY must retain the original grantor, without adding any
    // memberships to the reproduced operator or leaving bootstrap grants behind.
    for (const m of catalog.memberships || []) {
      roleSQL += `\ngrant ${ident(m.granted_role)} to ${ident(m.member)} with admin ${m.admin_option}, inherit ${m.inherit_option}, set ${m.set_option} granted by ${ident(m.grantor)};`
    }
    save('synthetic-roles.private.sql', roleSQL)
    psql(roleSQL, env, { log: 'roles-restore.private.log' })
    // Bootstrap owns the isolated database initially. Restore the captured
    // DATABASE owner BEFORE schema/catalog comparison or equivalent execution:
    // pg_database_owner is implicit and is not a pg_auth_members edge.
    assertOwnershipEvidence(catalog)
    psql(`alter database postgres owner to ${ident(catalog.database.owner)};`, env,
      { log: 'database-owner-restore.private.log' })
    // Database ACLs are omitted by the schema-filtered archive too. Restore
    // only captured state as bootstrap scaffolding, never an extra operator grant.
    let databaseSQL = `alter database postgres connection limit ${catalog.database.connection_limit};\n`
    if (catalog.database.raw_acl !== null) {
      databaseSQL += `revoke all on database postgres from public,${ident(catalog.database.owner)};\n`
      for (const c of catalog.database.acl) {
        if (!['CREATE','CONNECT','TEMPORARY'].includes(c.privilege) || typeof c.is_grantable !== 'boolean')
          throw new Error('Unsupported captured database ACL')
        databaseSQL += `set session authorization ${ident(c.grantor)};
grant ${c.privilege} on database postgres to ${c.grantee === 'PUBLIC' ? 'PUBLIC' : ident(c.grantee)}${c.is_grantable ? ' with grant option' : ''};
reset session authorization;\n`
      }
    }
    save('synthetic-database-context.private.sql', databaseSQL)
    psql(databaseSQL, env, { log: 'database-context-restore.private.log' })
    psql('drop schema public;', env, { log: 'empty-public-drop.private.log' })
    // Schema-filtered pg_dump omits extensions; recreate only installed bundled dependencies.
    for (const e of dependencies.extensions || []) {
      if (!['pgcrypto', 'uuid-ossp'].includes(e.name)) continue
      psql(`create schema if not exists ${ident(e.schema)} authorization ${ident(e.schema_owner)};
create extension ${ident(e.name)} with schema ${ident(e.schema)} version ${quote(e.version)};`, env,
      { log: `extension-${e.name}.private.log` })
    }
    run('pg_restore', ['-w', '--exit-on-error', '--single-transaction', '--dbname=postgres',
      join(directory, 'application-auth.dump')], env, { log: 'restore.private.log' })
    status.restore = 'completed'
    // Schema-filtered dumps omit defaults outside selected schemas. Reproduce
    // those captured platform catalog cells as labelled synthetic scaffolding,
    // without claiming the archive contains all platform schemas or data.
    const outside = (catalog.defaults || []).filter(d => d.schema === '<global>' || !scopes.includes(d.schema))
    let scaffold = ''
    for (const d of outside) {
      if (d.creator === 'supabase_admin') continue // Replayed raw-order below, including public dump rows.
      if (d.schema !== '<global>') scaffold += `create schema if not exists ${ident(d.schema)};\n`
      scaffold += `set session authorization ${ident(d.grantor)};
alter default privileges for role ${ident(d.creator)} ${d.schema === '<global>' ? '' : `in schema ${ident(d.schema)}`}
grant ${d.privilege} on ${{r:'tables',S:'sequences',f:'functions',T:'types',n:'schemas'}[d.type]} to ${d.grantee === 'PUBLIC' ? 'PUBLIC' : ident(d.grantee)}${d.is_grantable ? ' with grant option' : ''};
reset session authorization;\n`
    }
    // pg_dump emits equivalent ACLs in its own order. Reproduce the captured
    // raw platform baseline during bootstrap ONLY, before operator verification.
    // Decode aclitems in PostgreSQL (quoted names/options), never UPDATE catalogs.
    // Clearing per-schema groups removes the synthetic dump row; first-grant
    // order then reconstructs the exact original aclitem array.
    for (const row of catalog.default_rows.filter(d => d.creator === 'supabase_admin')) {
      const objectType = { r: 'tables', S: 'sequences', f: 'functions' }[row.type]
      if (row.schema === '<global>' || !objectType) throw new Error('Unsupported retained platform raw row')
      scaffold += `create schema if not exists ${ident(row.schema)};
set session authorization ${ident(row.creator)};
select format('alter default privileges for role %I in schema %I revoke all on ${objectType} from %s;',
  ${quote(row.creator)},${quote(row.schema)},string_agg(distinct case when a.grantee=0 then 'PUBLIC' else quote_ident(r.rolname) end,','))
from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
left join pg_roles r on r.oid=a.grantee
where d.defaclrole=${quote(row.creator)}::regrole and d.defaclnamespace=${quote(row.schema)}::regnamespace
  and d.defaclobjtype=${quote(row.type)}
having count(*)>0
\u005cgexec
reset session authorization;
select format('set session authorization %I; alter default privileges for role %I in schema %I grant %s on ${objectType} to %s%s; reset session authorization;',
  g.rolname,${quote(row.creator)},${quote(row.schema)},string_agg(a.privilege_type,',' order by a.privilege_type),
  case when a.grantee=0 then 'PUBLIC' else quote_ident(r.rolname) end,
  case when a.is_grantable then ' with grant option' else '' end)
from unnest(${quote(row.raw_acl)}::aclitem[]) with ordinality item(acl,position)
cross join lateral aclexplode(array[item.acl]) a
join pg_roles g on g.oid=a.grantor left join pg_roles r on r.oid=a.grantee
group by item.position,g.rolname,a.grantee,r.rolname,a.is_grantable
order by item.position,a.is_grantable
\u005cgexec
`
    }
    // Replay captured schema ACL entries, including explicit legacy owner grants
    // which pg_dump's public-schema special handling can omit.
    for (const s of catalog.schemas) if (s.raw_acl !== null) {
      scaffold += `select format('set session authorization %I; grant %s on schema %I to %s%s; reset session authorization;',
g.rolname,a.privilege_type,${quote(s.nspname)},case when a.grantee=0 then 'PUBLIC' else quote_ident(r.rolname) end,
case when a.is_grantable then ' with grant option' else '' end)
from aclexplode(${quote(s.raw_acl)}::aclitem[]) a join pg_roles g on g.oid=a.grantor left join pg_roles r on r.oid=a.grantee
\u005cgexec
`
    }
    save('synthetic-platform-defaults-and-schema-acl.private.sql', scaffold)
    psql(scaffold, env, { log: 'synthetic-platform-catalog.private.log' })
    status.outside_scope_default_acl_scaffolding_cells = outside.length
    status.catalog_comparison = 'semantic ACLs/owners; ACL array order, NULL owner defaults and dropped-column attnum gaps normalized'
    const captureLocal = name => {
      const result = run('psql', ['-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1',
        '-f', join(root, 'scripts/convergence-capture.sql')], { ...env, PGUSER: catalog.operator.role,
        PGOPTIONS: `${env.PGOPTIONS} -c default_transaction_read_only=on` }, { log: `${name}-diagnostics.private.log` })
      save(`${name}.jsonl`, result.stdout)
      return parseLines(result.stdout)
    }
    const after = captureLocal('restored')
    status.verification = compareCaptures(before, after)
    save('restore-comparison.json', JSON.stringify(status.verification, null, 2))
    if (Object.entries(status.verification).some(([key, value]) => key !== 'fingerprint_tables' && key !== 'fingerprint_matches' && !value))
      throw new Error('Restored fingerprint/catalog mismatch; see private comparison')
    const localCatalog = after.find(r => r.kind === 'catalog')
    status.roles_exact = same(catalog.roles, localCatalog.roles)
    status.role_connection_limits_exact = same(dependencies.role_connection_limits,
      JSON.parse(psql('select jsonb_object_agg(rolname,rolconnlimit)::text from pg_roles;', env).stdout))
    status.memberships_checked = catalog.memberships.length
    status.memberships_exact = same(catalog.memberships, localCatalog.memberships)
    status.operator_restrictions_exact = same(catalog.operator, localCatalog.operator)
    if (!status.roles_exact || !status.role_connection_limits_exact || !status.memberships_exact || !status.operator_restrictions_exact)
      throw new Error('Reproduced role/operator privilege mismatch')
    // Validate every captured FK against actual restored rows, not only catalog validity flags.
    const relationships = psql(`begin read only;
select format('select jsonb_build_object(''constraint'',%L,''match'',%L,''columns'',%s,''violations'',count(*))::text from %s child where (%s and not exists (select 1 from %s parent where %s)) %s;',
  c.conname,c.confmatchtype,cardinality(c.conkey),c.conrelid::regclass,
  string_agg(format('child.%I is not null',ca.attname),' and ' order by ck.i),c.confrelid::regclass,
  string_agg(format('parent.%I OPERATOR(%I.%s) child.%I',pa.attname,opn.nspname,op.oprname,ca.attname),' and ' order by ck.i),
  case when c.confmatchtype='f' then format('or ((%s) and (%s))',
    string_agg(format('child.%I is not null',ca.attname),' or ' order by ck.i),
    string_agg(format('child.%I is null',ca.attname),' or ' order by ck.i)) else '' end)
from pg_constraint c join pg_class t on c.conrelid=t.oid join pg_namespace n on t.relnamespace=n.oid
cross join lateral unnest(c.conkey,c.confkey,c.conpfeqop) with ordinality ck(childnum,parentnum,eqop,i)
join pg_attribute ca on ca.attrelid=c.conrelid and ca.attnum=ck.childnum
join pg_attribute pa on pa.attrelid=c.confrelid and pa.attnum=ck.parentnum
join pg_operator op on op.oid=ck.eqop join pg_namespace opn on opn.oid=op.oprnamespace
where c.contype='f' and n.nspname in ('public','sync_private','collaboration_private','auth')
group by c.oid,c.conname,c.conrelid,c.confrelid order by c.oid
\u005cgexec
rollback;`, env, { log: 'relationships.private.log' })
    const relationRows = parseLines(relationships.stdout)
    status.foreign_keys_checked = relationRows.length
    status.multicolumn_foreign_keys_checked = relationRows.filter(r => r.columns > 1).length
    status.match_full_foreign_keys_checked = relationRows.filter(r => r.match === 'f').length
    status.foreign_key_semantics = 'catalog parent-child equality operators; MATCH SIMPLE and FULL including partially NULL composite keys'
    status.foreign_key_violations = relationRows.reduce((n, r) => n + Number(r.violations), 0)
    if (status.foreign_key_violations) throw new Error('Restored relationship violations')
    // One connection as the actual equivalent live role. ON_ERROR_STOP aborts the
    // package at its first error; closing the connection rolls back the open transaction.
    const packageSQL = migrationNames.map(n => readFileSync(join(root, 'supabase/migrations', n), 'utf8')).join('\n')
    const graphExact = records => {
      const c = records.find(r => r.kind === 'catalog')
      return same(catalog.roles, c.roles) && same(catalog.memberships, c.memberships) &&
        same(catalog.operator, c.operator) && same(localCatalog.database, c.database)
    }
    // No synthetic-superuser migration stage and NO temporary CREATE grant.
    // All three migrations must succeed under the actual equivalent operator.
    psql(packageSQL, { ...env, PGUSER: catalog.operator.role },
      { log: 'equivalent-operator-migration.private.log' })
    status.migration_operator = 'all three migrations committed as equivalent captured operator'
    const migrated = captureLocal('after-operator-migrations')
    const migrationComparison = compareCaptures(before, migrated)
    status.migration_comparison = migrationComparison
    const changedChecks = new Set(['object_owners_and_acl', 'effective_object_acl', 'default_acl', 'functions'])
    if (Object.entries(migrationComparison).some(([key, value]) =>
      !changedChecks.has(key) && !['fingerprint_tables','fingerprint_matches'].includes(key) && value !== true) || !graphExact(migrated))
      throw new Error('Operator migration modified protected data/catalog/roles/ownership')
    const migratedCatalog = migrated.find(r => r.kind === 'catalog')
    assertDefaultScope(migratedCatalog)
    // Do not merely allow arbitrary changes in the four expected diff categories.
    // Derive the exact changed cells and sole new object from the frozen capture.
    const normalize = s => s.replaceAll(', ', ',')
    const tableTargets = new Set(['regions','labels','places','place_regions','place_labels','trips',
      'itinerary_items','route_maps','route_map_places','user_roles'].map(n => `public.${n}`))
    const helperTargets = new Set(['app_backup_preview_clear()','app_backup_apply_clear(text)',
      'app_backup_account_counts(uuid)','app_backup_has_shared_trip(uuid)',
      'app_backup_account_signature(uuid)','app_backup_assert_payload(jsonb)',
      'app_backup_preview_replace(jsonb)','app_backup_apply_replace(jsonb,text)',
      'can_manage_trip_acl(uuid)'].map(n => `public.${n}`))
    const triggerTargets = new Set(['public.assign_private_record_owner()', 'public.assign_route_map_record_owner()'])
    const removedCell = c => (c.kind === 'table' && tableTargets.has(c.identity) && (
      (c.grantee === 'authenticated' && ['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'].includes(c.privilege)) ||
      (c.identity === 'public.user_roles' && c.grantee === 'anon'))) ||
      (c.kind === 'function' && ((c.grantee === 'anon' && helperTargets.has(normalize(c.identity))) ||
        (['anon','authenticated'].includes(c.grantee) && triggerTargets.has(normalize(c.identity)))))
    const reorderIdentity = 'public.app_reorder_itinerary_items(uuid, date, uuid[])'
    const expectedCells = catalog.cells.filter(c => !removedCell(c)).concat(
      ['postgres','authenticated'].map(grantee => ({ kind: 'function', identity: reorderIdentity,
        owner: 'postgres', grantor: 'postgres', grantee, privilege: 'EXECUTE', is_grantable: false })))
    const semanticDefaults = rows => sortedCells(rows.map(({ oid, raw_acl, ...cell }) => cell))
    const expectedDefaults = catalog.defaults.filter(c => !(c.creator === 'postgres' && c.schema === 'public' &&
      ['anon','authenticated'].includes(c.grantee)))
    const objectOwners = rows => sortedCells(rows.map(({ kind, identity, owner }) => ({ kind, identity, owner })))
    status.exact_migration_acl_and_owners = same(sortedCells(expectedCells), sortedCells(migratedCatalog.cells)) &&
      same(semanticDefaults(expectedDefaults), semanticDefaults(migratedCatalog.defaults)) &&
      same(objectOwners(catalog.objects.concat({ kind: 'function', identity: reorderIdentity, owner: 'postgres' })),
        objectOwners(migratedCatalog.objects))
    if (!status.exact_migration_acl_and_owners)
      throw new Error('Operator migration differs from exact captured ACL/default/object poststate')
    const platformDefaults = c => c.defaults.filter(d => d.creator === 'supabase_admin')
    status.retained_platform_defaults_raw_exact = same(platformDefaults(localCatalog), platformDefaults(migratedCatalog))
      && same(localCatalog.default_rows.filter(d => d.creator === 'supabase_admin'),
        migratedCatalog.default_rows.filter(d => d.creator === 'supabase_admin'))
    if (!status.retained_platform_defaults_raw_exact || migratedCatalog.defaults.some(d =>
      d.creator === 'postgres' && ['public','<global>'].includes(d.schema) && ['anon','authenticated'].includes(d.grantee)))
      throw new Error('Operator migration default ACL poststate mismatch')
    const migratedFunctions = migrated.find(r => r.kind === 'catalog').functions
    if (catalog.functions.some(f => !migratedFunctions.some(g => same({ ...f, definition: undefined }, { ...g, definition: undefined }))))
      throw new Error('Operator migration changed original function source/config/owner')
    const receiptFingerprints = before.filter(r => r.kind === 'fingerprint' && /receipt/i.test(r.table))
    const receiptsExact = records => receiptFingerprints.every(f => records.some(g => same(f, g)))
    status.receipt_tables_checked = receiptFingerprints.length
    status.migration_receipt_fingerprints_exact = receiptsExact(migrated)

    // Execute the frozen candidate verbatim. Its own exact poststate/source/
    // owner/config guards must pass; no regeneration, substitution or override.
    status.recovery = 'started: frozen candidate as equivalent captured operator'
    psql(readFileSync(join(directory, 'exact-recovery.UNREHEARSED.sql'), 'utf8'), { ...env, PGUSER: catalog.operator.role },
      { log: 'exact-recovery.private.log' })
    const recovered = captureLocal('after-exact-recovery')
    status.recovery_comparison = compareCaptures(before, recovered)
    status.recovery_roles_exact = graphExact(recovered)
    status.recovery_receipt_fingerprints_exact = receiptsExact(recovered)
    status.recovery_platform_defaults_raw_exact = same(localCatalog.default_rows.filter(d => d.creator === 'supabase_admin'),
      recovered.find(r => r.kind === 'catalog').default_rows.filter(d => d.creator === 'supabase_admin'))
    if (Object.entries(status.recovery_comparison).some(([key, value]) =>
      !['fingerprint_tables','fingerprint_matches'].includes(key) && value !== true) || !status.recovery_roles_exact ||
      !status.recovery_receipt_fingerprints_exact || !status.recovery_platform_defaults_raw_exact)
      throw new Error('Exact recovery did not restore captured state')
    status.recovery = 'success: equivalent operator restored exact captured semantic state using frozen guarded transaction'
    status.isolated_operator_authority_verified = true // NOT live installation approval
    save('recovery-rehearsal-attestation.json', JSON.stringify({
      candidate_sha256: sha(readFileSync(join(directory, 'exact-recovery.UNREHEARSED.sql'))),
      sources: receipt.sources, convergence_scope: convergenceScope, candidate_unchanged: true,
      equivalent_operator_only: true, isolated_authority_verified: true, live_execution_authorized: false,
      comparison: status.recovery_comparison,
    }, null, 2))
  } catch (error) {
    status.blocker = error instanceof Error ? redact(error.message) : 'Isolated rehearsal failed'
    throw error
  } finally {
    if (existsSync(join(data, 'postmaster.pid'))) {
      const stopped = run('pg_ctl', ['-D', data, '-m', 'fast', '-w', '-t', '30', 'stop'], cleanEnv(),
        { log: 'server-stop.private.log', allowFailure: true })
      status.cluster_stopped = stopped.status === 0
    }
    if (existsSync(join(work, 'server.private.log'))) save('server.private.log', readFileSync(join(work, 'server.private.log')))
    save('rehearsal-status.json', JSON.stringify(status, null, 2))
    // Paths and diagnostics remain in the private status file, never stdout.
    console.log(JSON.stringify({ status: status.blocker ? 'blocked' : 'completed',
      convergence_scope: convergenceScope, live_writes: false, network_isolated: true,
      restore: status.restore, migration_operator: status.migration_operator,
      recovery: status.recovery, isolated_operator_authority_verified: status.isolated_operator_authority_verified }, null, 2))
  }
}

try {
  if (process.argv[2] === '--isolated') isolated()
  else if (process.argv.length === 2) await backup()
  else throw new Error('Unsupported arguments')
} catch (error) {
  // Never print child output, connection values, row data, stack traces or URL parse errors.
  const message = error instanceof Error && !['TypeError', 'SyntaxError'].includes(error.name)
    ? redact(error.message) : 'Operation failed; sensitive details omitted'
  if (directory) save(`failure-${process.pid}.private.txt`, message + '\n')
  console.error(JSON.stringify({ status: 'blocked', reason: message, live_writes: false }))
  process.exitCode = 1
}