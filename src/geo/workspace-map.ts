import type { GeoProvider } from './contracts'
import { createMapLibreRenderer } from './adapters/osm/maplibre-renderer'
import { createOsmStyle, loadOsmMapLibre, osmDefaultBounds, osmDefaultCenter } from './adapters/osm/osm-resources'
import type { GoogleMapHandle, GoogleMapMarkerData, GoogleMapPosition, GoogleMapViewport } from '../modules/place/google-places.service'
import './map.css'
import '../modules/place/google-map.css'
import { throwIfAborted, withAbort } from './errors'

export function osmAssetBaseUrl(): string {
  const base = import.meta.env.VITE_OSM_ASSET_BASE_URL?.trim()
  if (base) {
    const parsed = new URL(base, window.location.origin)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('OSM 圖資網址必須使用 HTTP 或 HTTPS。')
    return parsed.href.replace(/\/$/, '')
  }
  if (import.meta.env.DEV) return ''
  throw new Error('尚未設定 OSM 圖資服務；請設定 VITE_OSM_ASSET_BASE_URL，不會自動切回 Google。')
}

export async function mountWorkspaceMap(
  provider: GeoProvider, host: HTMLElement,
  options: { center: GoogleMapPosition; zoom: number; viewport?: GoogleMapViewport; maxZoom?: number; signal?: AbortSignal },
  onError: (error: Error) => void,
): Promise<GoogleMapHandle> {
  throwIfAborted(options.signal)
  if (provider === 'google') {
    const { mountGoogleMap } = await import('../modules/place/google-places.service')
    throwIfAborted(options.signal)
    return mountGoogleMap(host, options)
  }
  const base = osmAssetBaseUrl()
  const [sdk, style] = await withAbort(Promise.all([
    loadOsmMapLibre(base),
    import.meta.env.VITE_OSM_STYLE_URL?.trim() || createOsmStyle(base),
  ]), options.signal)
  const renderer = createMapLibreRenderer({
    loadSdk: () => Promise.resolve(sdk),
    style,
  })
  let markers: GoogleMapMarkerData[] = []
  const handle = await renderer.mount(host, {
    center: osmDefaultCenter, zoom: 9.5,
    bounds: osmDefaultBounds, maxZoom: options.maxZoom ?? 17, signal: options.signal,
    events: {
      onSelect: id => markers.find(marker => marker.id === id)?.onClick?.(),
      onError,
    },
  })
  return {
    setMarkers(next, fit) {
      markers = next
      handle.setMarkers(next.map(marker => ({
        id: marker.id, name: marker.title,
        coordinate: { latitude: marker.position.lat, longitude: marker.position.lng },
        sequence: marker.sequence,
        color: marker.color ?? (marker.sequence === undefined ? '#6d91ad' : '#648a74'),
        selected: marker.enlarged,
      })))
      if (fit?.fitBounds && next.length) handle.fitMarkers()
    },
    setRoute: lines => handle.setRoute?.(lines),
    resetView: () => handle.fitBounds(osmDefaultBounds),
    destroy: () => handle.destroy(),
  }
}
