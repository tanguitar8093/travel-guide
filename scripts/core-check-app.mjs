import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'

const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: process.platform === 'win32' })
const buildFailed = build.status !== 0
if (buildFailed) console.error('[core-check:app] 專案建置失敗，仍會繼續檢查開發伺服器。')

const port = await getAvailablePort()
const vite = spawn(process.execPath, [
  'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort',
], { stdio: 'ignore' })
const url = `http://127.0.0.1:${port}/`

try {
  const started = await waitForServer(url, vite)
  if (!started) {
    console.error('[core-check:app] Vite 開發伺服器未能在期限內啟動。')
    process.exitCode = 1
  } else {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) })
    if (!response.ok) {
      console.error(`[core-check:app] 首頁回應 HTTP ${response.status}。`)
      process.exitCode = 1
    } else {
      console.log('[core-check:app] Vite 開發伺服器啟動成功，首頁回應正常。')
    }
  }
} catch {
  console.error('[core-check:app] 無法啟動或連線至 Vite 開發伺服器。')
  process.exitCode = 1
} finally {
  vite.kill('SIGTERM')
}

if (buildFailed) process.exitCode = 1

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Unable to determine an available port.'))
        return
      }
      server.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
}

async function waitForServer(targetUrl, process) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline && process.exitCode === null) {
    try {
      const response = await fetch(targetUrl, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) return true
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  return false
}
