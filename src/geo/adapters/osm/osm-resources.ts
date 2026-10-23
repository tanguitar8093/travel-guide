import type { MapLibreSdk } from './maplibre-renderer'
import { geoError } from '../../errors'
import { OKINAWA_OSM_BOUNDS } from '../../osm-coverage'

export const osmDefaultCenter = { latitude: 26.43, longitude: 127.9 }
export const osmDefaultBounds = OKINAWA_OSM_BOUNDS

type OsmSdk = MapLibreSdk & { setWorkerUrl(url: string): void }

function isOsmSdk(value: unknown): value is OsmSdk {
  return typeof value === 'object' && value !== null &&
    'Map' in value && typeof value.Map === 'function' &&
    'Marker' in value && typeof value.Marker === 'function' &&
    'NavigationControl' in value && typeof value.NavigationControl === 'function' &&
    'setWorkerUrl' in value && typeof value.setWorkerUrl === 'function'
}

const loading = new Map<string, Promise<MapLibreSdk>>()

export function loadOsmMapLibre(baseUrl: string): Promise<MapLibreSdk> {
  const cached = loading.get(baseUrl)
  if (cached) return cached
  const resource = (path: string) => `${baseUrl.replace(/\/$/, '')}/${path}`
  const pending = (async () => {
    const cssReady = new Promise<void>((resolve, reject) => {
      const css = document.createElement('link')
      const timeout = setTimeout(() => finish(geoError('SERVICE_UNAVAILABLE', 'MapLibre 樣式載入逾時。')), 15000)
      const finish = (error?: Error) => {
        clearTimeout(timeout)
        css.onload = null
        css.onerror = null
        if (error) { css.remove(); reject(error) } else resolve()
      }
      css.rel = 'stylesheet'
      css.href = resource('osm-vendor/maplibre-gl.css')
      css.onload = () => finish()
      css.onerror = () => finish(geoError('SERVICE_UNAVAILABLE', 'MapLibre 樣式載入失敗。'))
      document.head.append(css)
    })
    const url = resource('osm-vendor/maplibre-gl.mjs')
    const [module]: [unknown, void] = await Promise.all([import(/* @vite-ignore */ url), cssReady])
    const sdk = typeof module === 'object' && module !== null && 'default' in module ? module.default : module
    if (!isOsmSdk(sdk)) throw geoError('SERVICE_UNAVAILABLE', 'MapLibre SDK 格式不正確。')
    sdk.setWorkerUrl(resource('osm-vendor/maplibre-gl-worker.mjs'))
    return sdk
  })().catch(cause => { loading.delete(baseUrl); throw cause })
  loading.set(baseUrl, pending)
  return pending
}

export async function createOsmStyle(baseUrl: string) {
  const service = baseUrl || '/local-map'
  const sourceUrl = new URL(`${service.replace(/\/$/, '')}/tiles.json`, window.location.origin)
  const response = await fetch(sourceUrl, { cache: 'no-cache' })
  if (!response.ok) throw geoError('SERVICE_UNAVAILABLE', '沖繩向量圖磚尚未就緒，請在 maps 專案執行 npm run build:tiles 並重新啟動圖資服務。')
  const tiles: unknown = await response.json()
  if (typeof tiles !== 'object' || tiles === null ||
      !('tiles' in tiles) || !Array.isArray(tiles.tiles) || !tiles.tiles.length || !tiles.tiles.every(url => typeof url === 'string') ||
      !('minzoom' in tiles) || !Number.isInteger(tiles.minzoom) ||
      !('maxzoom' in tiles) || !Number.isInteger(tiles.maxzoom) ||
      !('bounds' in tiles) || !Array.isArray(tiles.bounds) || tiles.bounds.length !== 4 || !tiles.bounds.every(Number.isFinite) ||
      !('vector_layers' in tiles) || !Array.isArray(tiles.vector_layers) ||
      !['land', 'water', 'coastline', 'roads'].every(id => (tiles.vector_layers as unknown[]).some((layer: unknown) => typeof layer === 'object' && layer !== null && 'id' in layer && layer.id === id))) {
    throw geoError('SERVICE_UNAVAILABLE', '沖繩向量圖磚索引格式不正確。')
  }
  const tileUrls = tiles.tiles.map((url: string) => {
    // Root-relative tile paths belong to the map service, including its proxy/base path.
    const resolved = url.startsWith('/')
      ? new URL(`${service.replace(/\/$/, '')}${url}`, window.location.origin)
      : new URL(url, sourceUrl)
    if (!['http:', 'https:'].includes(resolved.protocol)) throw geoError('SERVICE_UNAVAILABLE', '圖磚網址必須使用 HTTP 或 HTTPS。')
    return resolved.href.replace(/%7B/gi, '{').replace(/%7D/gi, '}')
  })
  return {
  version: 8,
  sources: {
    basemap: { type: 'vector', tiles: tileUrls, minzoom: tiles.minzoom, maxzoom: tiles.maxzoom, bounds: tiles.bounds,
      attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors · ODbL</a>' },
  },
  layers: [
    { id: 'sea', type: 'background', paint: { 'background-color': '#bcdde1' } },
    { id: 'land', type: 'fill', source: 'basemap', 'source-layer': 'land', paint: { 'fill-color': '#f3f1e7' } },
    { id: 'coast', type: 'line', source: 'basemap', 'source-layer': 'coastline', paint: { 'line-color': '#87b8b8', 'line-width': 1 } },
    { id: 'water', type: 'fill', source: 'basemap', 'source-layer': 'water', paint: { 'fill-color': '#bcdde1' } },
    { id: 'roads', type: 'line', source: 'basemap', 'source-layer': 'roads', minzoom: 10, paint: { 'line-color': '#fffdf9', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, .4, 14, 2, 17, 7] } },
    { id: 'main-roads', type: 'line', source: 'basemap', 'source-layer': 'roads', filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary']]], paint: { 'line-color': '#e4bb7a', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, .6, 12, 2, 17, 9] } },
  ],
  }
}
