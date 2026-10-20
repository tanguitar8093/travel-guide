try {
  process.loadEnvFile('.env.local')
} catch {
  console.error('[core-check:supabase] 找不到或無法讀取 .env.local。')
  process.exit(1)
}

const projectUrl = process.env.VITE_SUPABASE_URL?.trim()
const anonKey = process.env.VITE_SUPABASE_ANON_KEY?.trim()

if (!projectUrl || !anonKey) {
  console.error('[core-check:supabase] .env.local 需要設定 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY。')
  process.exit(1)
}

let endpoint
try {
  endpoint = new URL('/rest/v1/', projectUrl)
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('Unsupported protocol.')
} catch {
  console.error('[core-check:supabase] VITE_SUPABASE_URL 格式無效。')
  process.exit(1)
}

try {
  const response = await fetch(endpoint, {
    headers: {
      apikey: anonKey,
      accept: 'application/openapi+json',
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    console.error(`[core-check:supabase] Supabase REST API 回應 HTTP ${response.status}。`)
    process.exit(1)
  }
  console.log('[core-check:supabase] Supabase REST API 連線正常。')
} catch {
  console.error('[core-check:supabase] 無法連線至 Supabase REST API。')
  process.exit(1)
}
