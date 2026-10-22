import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const root = fileURLToPath(new URL('.', import.meta.url))
const workspace = path.resolve(root, '../..')
const maps = process.env.OSM_PROJECT_DIR || '/home/tanguitar/workspaces/maps'

export default defineConfig({
  root,
  envDir: workspace,
  plugins: [{
    name: 'map-provider-poc-assets',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = (request.url || '').split('?')[0]
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
          server.config.logger.error(`Map provider PoC asset unavailable: ${cause instanceof Error ? cause.message : 'unknown error'}`)
          response.statusCode = 503
          response.end('缺少 maps 專案的圖資或 MapLibre 檔案。')
        }
      })
    },
  }, react()],
  server: { host: '127.0.0.1', port: 5176, strictPort: true, fs: { allow: [workspace] } },
})
