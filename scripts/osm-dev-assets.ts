import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Plugin } from 'vite'

export function osmDevAssets(): Plugin {
  return {
    name: 'travel-osm-dev-assets',
    apply: 'serve',
    configureServer(server) {
      const maps = process.env.OSM_PROJECT_DIR || '/home/tanguitar/workspaces/maps'
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
          server.config.logger.error(`OSM resource unavailable: ${cause instanceof Error ? cause.message : String(cause)}`)
          response.statusCode = 503
          response.end('OSM 圖資或 MapLibre 資產不可用，請確認 OSM_PROJECT_DIR。')
        }
      })
    },
  }
}
