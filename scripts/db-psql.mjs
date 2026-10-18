import { spawnSync } from 'node:child_process'

const connection = process.env.SUPABASE_DB_URL
if (!connection) throw new Error('SUPABASE_DB_URL is missing. Load .env.local using node --env-file.')
const url = new URL(connection)
if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
  throw new Error('SUPABASE_DB_URL must be a PostgreSQL connection URL.')
}
const env = {
  ...process.env,
  PGHOST: url.hostname,
  PGPORT: url.port || '5432',
  PGUSER: decodeURIComponent(url.username),
  PGPASSWORD: decodeURIComponent(url.password),
  PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
  PGSSLMODE: url.searchParams.get('sslmode') || 'require',
  PGCONNECT_TIMEOUT: '15',
}
const result = spawnSync('psql', [
  '-X', '-w', '-v', 'ON_ERROR_STOP=1', ...process.argv.slice(2),
], { env, stdio: ['inherit', 'inherit', 'pipe'], encoding: 'utf8' })
if (result.stderr) {
  let message = result.stderr
  for (const secret of [connection, url.hostname, env.PGUSER, env.PGPASSWORD].filter(Boolean)) {
    message = message.replaceAll(secret, '[redacted]')
  }
  process.stderr.write(message)
}
if (result.error) {
  console.error(`Unable to start psql: ${result.error.code ?? 'unknown error'}`)
}
process.exit(result.status ?? 1)
