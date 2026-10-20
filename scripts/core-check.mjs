import { spawnSync } from 'node:child_process'

const checks = [
  ['專案啟動', ['run', 'core-check:app']],
  ['Supabase API', ['run', 'core-check:supabase']],
  ['Google Maps API', ['run', 'core-check:google']],
  ['快速 e2e', ['run', 'e2e:smoke']],
  ['psql 資料庫連線', ['run', 'core-check:psql']],
]

const results = []

for (const [name, args] of checks) {
  console.log(`\n[core-check] ${name}`)
  const result = spawnSync('npm', args, { stdio: 'inherit', shell: process.platform === 'win32' })
  const passed = result.status === 0
  results.push([name, passed])
  console.log(`[core-check] ${passed ? '通過' : '失敗'}：${name}`)
}

console.log('\n[core-check] 結果')
for (const [name, passed] of results) {
  console.log(`- ${passed ? '通過' : '失敗'}：${name}`)
}

if (results.some(([, passed]) => !passed)) process.exitCode = 1
