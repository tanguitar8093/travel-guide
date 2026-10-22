import type { MapLibreSdk } from './maplibre-renderer'
import { geoError } from '../../errors'

export const osmDefaultCenter = { latitude: 26.43, longitude: 127.9 }
export const osmDefaultBounds = { north: 26.9, south: 25.98, east: 128.36, west: 127.58 }

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
    await new Promise<void>((resolve, reject) => {
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
    const module: unknown = await import(/* @vite-ignore */ url)
    const sdk = typeof module === 'object' && module !== null && 'default' in module ? module.default : module
    if (!isOsmSdk(sdk)) throw geoError('SERVICE_UNAVAILABLE', 'MapLibre SDK 格式不正確。')
    sdk.setWorkerUrl(resource('osm-vendor/maplibre-gl-worker.mjs'))
    return sdk
  })().catch(cause => { loading.delete(baseUrl); throw cause })
  loading.set(baseUrl, pending)
  return pending
}

export function createOsmStyle(baseUrl: string) {
  const resource = (name: string) => `${baseUrl.replace(/\/$/, '')}/osm-assets/${name}.geojson`
  return {
  version: 8,
  sources: {
    land: { type: 'geojson', data: resource('land'), attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>' },
    water: { type: 'geojson', data: resource('water') },
    roads: { type: 'geojson', data: resource('roads') },
  },
  layers: [
    { id: 'sea', type: 'background', paint: { 'background-color': '#bcdde1' } },
    { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': '#f3f1e7' } },
    { id: 'coast', type: 'line', source: 'land', paint: { 'line-color': '#87b8b8', 'line-width': 1 } },
    { id: 'water', type: 'fill', source: 'water', paint: { 'fill-color': '#bcdde1' } },
    { id: 'roads', type: 'line', source: 'roads', minzoom: 10, paint: { 'line-color': '#fffdf9', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, .4, 14, 2, 17, 7] } },
    { id: 'main-roads', type: 'line', source: 'roads', filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary']]], paint: { 'line-color': '#e4bb7a', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, .6, 12, 2, 17, 9] } },
  ],
  }
}
