import '../../src/modules/place/google-map.css'
import type { GoogleMapHandle, GoogleMapMarkerData, GoogleMapPosition, GoogleMapViewport } from '../../src/modules/place/google-places.service'

interface MapInstance {
  fitBounds(bounds: number[][], options: { padding: number; maxZoom?: number }): void
  addControl(control: unknown, position: string): void
  remove(): void
  resize(): void
  once(event: 'load', listener: () => void): void
  on(event: 'error', listener: (event: { error: Error }) => void): void
  off(event: 'error', listener: (event: { error: Error }) => void): void
}
interface MarkerInstance { setLngLat(position: number[]): MarkerInstance; addTo(map: MapInstance): MarkerInstance; remove(): void }
interface MapLibre {
  Map: new (options: object) => MapInstance
  Marker: new (options: object) => MarkerInstance
  NavigationControl: new (options: object) => unknown
  FullscreenControl: new () => unknown
  setWorkerUrl(url: string): void
}

// Keep the existing host and marker contract for this UI preview only.
// Production neutral provider contracts remain a separate implementation step.
export async function mountGoogleMap(container: HTMLElement, options: {
  center: GoogleMapPosition; zoom: number; viewport?: GoogleMapViewport; maxZoom?: number
}): Promise<GoogleMapHandle> {
  if (!document.querySelector('[data-osm-preview-css]')) {
    const css = document.createElement('link')
    css.rel = 'stylesheet'; css.href = '/osm-vendor/maplibre-gl.css'
    css.dataset.osmPreviewCss = 'true'; document.head.append(css)
  }
  const moduleUrl = '/osm-vendor/maplibre-gl.mjs'
  const imported = await import(/* @vite-ignore */ moduleUrl)
  const ml = (imported.default || imported) as MapLibre
  ml.setWorkerUrl('/osm-vendor/maplibre-gl-worker.mjs')
  const map = new ml.Map({
    container, center: [options.center.lng, options.center.lat], zoom: options.zoom, maxZoom: options.maxZoom || 17,
    style: {
      version: 8,
      sources: {
        land: { type: 'geojson', data: '/osm-assets/land.geojson', attribution: '© OpenStreetMap contributors' },
        water: { type: 'geojson', data: '/osm-assets/water.geojson' },
        roads: { type: 'geojson', data: '/osm-assets/roads.geojson' },
      },
      layers: [
        { id: 'sea', type: 'background', paint: { 'background-color': '#bcdde1' } },
        { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': '#f3f1e7' } },
        { id: 'coast', type: 'line', source: 'land', paint: { 'line-color': '#87b8b8', 'line-width': 1 } },
        { id: 'water', type: 'fill', source: 'water', paint: { 'fill-color': '#bcdde1' } },
        { id: 'roads', type: 'line', source: 'roads', minzoom: 10, paint: { 'line-color': '#fffdf9', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, .4, 14, 2, 17, 7] } },
        { id: 'main-roads', type: 'line', source: 'roads', filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary']]], paint: { 'line-color': '#e4bb7a', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, .6, 12, 2, 17, 9] } },
      ],
    },
  })
  map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right')
  map.addControl(new ml.FullscreenControl(), 'top-right')
  const resizeObserver = new ResizeObserver(() => map.resize())
  resizeObserver.observe(container)
  if (options.viewport) {
    const { west, south, east, north } = options.viewport
    map.fitBounds([[west, south], [east, north]], { padding: 50, maxZoom: 17 })
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        map.off('error', fail)
        reject(new Error('沖繩底圖載入逾時，請重試地圖。'))
      }, 60000)
      const fail = (event: { error: Error }) => {
        clearTimeout(timeout); map.off('error', fail); reject(event.error)
      }
      map.on('error', fail)
      map.once('load', () => {
        clearTimeout(timeout); map.off('error', fail); resolve()
      })
    })
  } catch (cause) {
    resizeObserver.disconnect()
    map.remove()
    throw cause
  }
  let mounted: MarkerInstance[] = [], destroyed = false
  return {
    setMarkers(markers: GoogleMapMarkerData[], options) {
      if (destroyed) return
      mounted.forEach(marker => marker.remove()); mounted = []
      for (const data of markers) {
        const element = document.createElement('button')
        element.type = 'button'; element.title = data.title
        element.setAttribute('aria-label', data.title)
        element.style.padding = '0'
        element.className = 'google-map-marker' + (data.sequence !== undefined ? ' google-map-marker-numbered' : '') + (data.enlarged ? ' google-map-marker-enlarged' : '')
        element.textContent = data.sequence === undefined ? '' : String(data.sequence)
        if (data.color) element.style.backgroundColor = data.color
        if (data.onClick) element.addEventListener('click', data.onClick)
        mounted.push(new ml.Marker({ element }).setLngLat([data.position.lng, data.position.lat]).addTo(map))
      }
      if (options?.fitBounds && markers.length) {
        const positions = markers.map(marker => marker.position)
        map.fitBounds([
          [Math.min(...positions.map(p => p.lng)), Math.min(...positions.map(p => p.lat))],
          [Math.max(...positions.map(p => p.lng)), Math.max(...positions.map(p => p.lat))],
        ], { padding: 50, maxZoom: 17 })
      }
    },
    destroy() {
      if (destroyed) return
      destroyed = true; resizeObserver.disconnect(); mounted.forEach(marker => marker.remove()); mounted = []; map.remove()
    },
  }
}
