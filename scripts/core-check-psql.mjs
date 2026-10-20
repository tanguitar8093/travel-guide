import { spawnSync } from 'node:child_process'

try {
  process.loadEnvFile('.env.local')
} catch {
  console.error('[core-check:psql] 找不到或無法讀取 .env.local。')
  process.exit(1)
}

if (!process.env.SUPABASE_DB_URL?.trim()) {
  console.error('[core-check:psql] .env.local 需要設定 SUPABASE_DB_URL。')
  process.exit(1)
}

const result = spawnSync(process.execPath, [
  'scripts/db-psql.mjs', '-X', '-Atqc', 'SELECT 1',
], { encoding: 'utf8' })

if (result.error || result.status !== 0) {
  const detail = result.stderr?.trim()
  console.error(`[core-check:psql] psql 連線失敗${detail ? `：${detail}` : '。'}`)
  process.exit(result.status ?? 1)
}

if (result.stdout.trim() !== '1') {
  console.error('[core-check:psql] 資料庫查詢未回傳預期結果。')
  process.exit(1)
}

console.log('[core-check:psql] psql 已連線，SELECT 1 成功。')
