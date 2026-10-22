import { spawn, type ChildProcess } from 'node:child_process'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Plugin } from 'vite'

export function osmDevAssets(): Plugin {
  return {
    name: 'travel-osm-dev-assets',
    apply: 'serve',
    configureServer(server) {
      const maps = process.env.OSM_PROJECT_DIR || '/home/tanguitar/workspaces/maps'
      const port = Number(process.env.OSM_SERVICE_PORT || 3000)
      const configuredService = process.env.OSM_SERVICE_URL
      let child: ChildProcess | undefined
      let startupError: string | undefined
      let stopping = false
      const startService = () => {
        child = spawn('python3', ['server.py'], {
          cwd: maps,
          env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        child.stdout?.on('data', (chunk: Buffer) => {
          const line = String(chunk).trim()
          if (line) server.config.logger.info(`[osm-local] ${line}`)
        })
        child.stderr?.on('data', (chunk: Buffer) => {
          const line = String(chunk).trim()
          if (line) server.config.logger.error(`[osm-local] ${line}`)
        })
        child.once('error', cause => {
          startupError = cause.message
          server.config.logger.error(`Could not start local OSM service: ${cause.message}`)
        })
        child.once('exit', (code, signal) => {
          if (stopping) return
          startupError = signal
            ? `maps service exited on ${signal}`
            : `maps service exited with code ${code ?? 'unknown'}`
        })
      }
      server.httpServer?.once('close', () => {
        stopping = true
        child?.kill('SIGTERM')
      })

      let ready: Promise<void> | undefined
      const waitForService = () => {
        if (configuredService) return Promise.resolve()
        ready ??= (async () => {
          const target = `http://127.0.0.1:${port}/api/health`
          const isMapsServiceReady = () => new Promise<boolean>(resolve => {
            const request = httpRequest(target, { timeout: 1500 }, response => {
              let body = ''
              response.setEncoding('utf8')
              response.on('data', chunk => { body += chunk })
              response.on('end', () => {
                try {
                  const health: unknown = JSON.parse(body)
                  resolve(response.statusCode === 200 && typeof health === 'object' && health !== null &&
                    'ok' in health && health.ok === true && 'dataset' in health && health.dataset === 'Okinawa OSM')
                } catch {
                  resolve(false)
                }
              })
            })
            request.on('timeout', () => { request.destroy(); resolve(false) })
            request.on('error', () => resolve(false))
            request.end()
          })
          if (await isMapsServiceReady()) return
          startService()
          for (let attempt = 0; attempt < 120; attempt += 1) {
            if (await isMapsServiceReady()) return
            if (startupError) throw new Error(startupError)
            await new Promise(resolve => setTimeout(resolve, 500))
          }
          throw new Error(startupError || 'maps service did not become ready within 60 seconds')
        })()
        return ready
      }

      server.middlewares.use(async (request, response, next) => {
        const pathname = (request.url || '').split('?')[0]
        if (pathname.startsWith('/local-map/')) {
          try {
            await waitForService()
            const target = new URL(configuredService || `http://127.0.0.1:${port}`)
            const proxyRequest = (target.protocol === 'https:' ? httpsRequest : httpRequest)({
              protocol: target.protocol,
              hostname: target.hostname,
              port: target.port || undefined,
              method: request.method,
              path: `${(request.url || '').replace(/^\/local-map/, '')}`,
              headers: { ...request.headers, host: target.host },
              timeout: 30000,
            }, proxyResponse => {
              response.statusCode = proxyResponse.statusCode ?? 502
              for (const [name, value] of Object.entries(proxyResponse.headers)) {
                if (value !== undefined && name !== 'transfer-encoding' && name !== 'connection') {
                  response.setHeader(name, value)
                }
              }
              proxyResponse.pipe(response)
            })
            proxyRequest.on('timeout', () => proxyRequest.destroy(new Error('maps service request timed out')))
            proxyRequest.on('error', cause => {
              if (!response.headersSent) {
                response.statusCode = 503
                response.setHeader('Content-Type', 'application/json; charset=utf-8')
                response.end(JSON.stringify({ error: `本機 OSM 服務無法使用：${cause.message}` }))
              } else response.destroy(cause)
            })
            request.pipe(proxyRequest)
          } catch (cause) {
            response.statusCode = 503
            response.setHeader('Content-Type', 'application/json; charset=utf-8')
            response.end(JSON.stringify({
              error: `本機 OSM 服務尚未就緒：${cause instanceof Error ? cause.message : String(cause)}。請確認 maps 專案資料與 Python 環境。`,
            }))
          }
          return
        }
        const asset = /^\/osm-assets\/(land|water|roads)\.geojson$/.exec(pathname)
        const vendor = /^\/osm-vendor\/(maplibre-gl(?:-worker|-shared)?\.mjs|maplibre-gl\.css)$/.exec(pathname)
        if (!asset && !vendor) return next()
        const filename = asset ? path.join(maps, 'data', `okinawa-${asset[1]}.geojson`)
          : path.join(maps, 'node_modules/maplibre-gl/dist', vendor![1])
        try {
          const body = await readFile(filename)
          response.setHeader('Content-Type', asset ? 'application/geo+json' : pathname.endsWith('.css') ? 'text/css' : 'text/javascript')
          response.end(body)
        } catch (cause) {
          server.config.logger.error(`OSM resource unavailable: ${cause instanceof Error ? cause.message : String(cause)}`)
          response.statusCode = 503
          response.end('OSM 圖資或 MapLibre 資產不可用，請確認 OSM_PROJECT_DIR。')
        }
      })
    },
  }
}
