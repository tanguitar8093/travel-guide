import type { Bounds, MapMarker, MapRenderer } from '../../contracts'
import { geoError, throwIfAborted, toGeoError, withAbort } from '../../errors'
import { markerBounds, validateBounds, validateCoordinate, validateMarkers, validateMountOptions, validateZoom } from '../../map-validation'
import { createMarkerElement } from '../../marker-element'

interface MapLibreMap {
  on(type: 'load', listener: () => void): void
  on(type: 'error', listener: (event: { error: Error }) => void): void
  off(type: 'load', listener: () => void): void
  off(type: 'error', listener: (event: { error: Error }) => void): void
  loaded(): boolean
  jumpTo(options: { center: [number, number]; zoom?: number }): void
  fitBounds(bounds: [[number, number], [number, number]], options: { padding: number; maxZoom: number; duration: number }): void
  addControl(control: unknown, position: 'top-right'): void
  resize(): void
  remove(): void
}

interface MapLibreMarker {
  setLngLat(position: [number, number]): MapLibreMarker
  addTo(map: MapLibreMap): MapLibreMarker
  remove(): void
}

export interface MapLibreSdk {
  Map: new (options: {
    container: HTMLElement; center: [number, number]; zoom: number; maxZoom: number
    style: object | string
  }) => MapLibreMap
  Marker: new (options: { element: HTMLElement }) => MapLibreMarker
  NavigationControl: new (options: { showCompass: boolean }) => unknown
  FullscreenControl?: new () => unknown
}

function mapLibreBounds(bounds: Bounds): [[number, number], [number, number]] {
  return [[bounds.west, bounds.south], [bounds.east < bounds.west ? bounds.east + 360 : bounds.east, bounds.north]]
}

export function createMapLibreRenderer(config: {
  loadSdk(): Promise<MapLibreSdk>
  style: object | string
}): MapRenderer {
  return {
    async mount(host, options) {
      validateMountOptions(options)
      throwIfAborted(options.signal)
      const sdk = await withAbort(config.loadSdk(), options.signal)
      throwIfAborted(options.signal)
      const container = document.createElement('div')
      container.className = 'geo-renderer-host'
      host.append(container)
      let map: MapLibreMap | undefined
      let observer: ResizeObserver | undefined
      let destroyed = false
      let ready = false
      let markers: readonly MapMarker[] = []
      let mounted: { marker: MapLibreMarker; dispose(): void }[] = []
      const clearMarkers = () => {
        for (const item of mounted) { item.dispose(); item.marker.remove() }
        mounted = []
      }
      const runtimeError = (event: { error: Error }) => {
        if (ready && !destroyed) {
          if (options.events?.onError) options.events.onError(toGeoError(event.error))
          else console.error('MapLibre renderer error', event.error)
        }
      }
      const destroy = () => {
        if (destroyed) return
        destroyed = true
        observer?.disconnect()
        clearMarkers()
        map?.off('error', runtimeError)
        map?.remove()
        container.remove()
      }
      try {
        map = new sdk.Map({
          container, center: [options.center.longitude, options.center.latitude],
          zoom: Math.min(options.zoom, options.maxZoom ?? 22), maxZoom: options.maxZoom ?? 22, style: config.style,
        })
        const currentMap = map
        currentMap.on('error', runtimeError)
        currentMap.addControl(new sdk.NavigationControl({ showCompass: false }), 'top-right')
        if (sdk.FullscreenControl) currentMap.addControl(new sdk.FullscreenControl(), 'top-right')
        observer = new ResizeObserver(() => { if (!destroyed) currentMap.resize() })
        observer.observe(container)
        await new Promise<void>((resolve, reject) => {
          const finish = (error?: Error) => {
            clearTimeout(timeout)
            currentMap.off('load', load)
            currentMap.off('error', fail)
            options.signal?.removeEventListener('abort', abort)
            if (error) reject(error); else resolve()
          }
          const load = () => finish()
          const fail = (event: { error: Error }) => finish(toGeoError(event.error))
          const abort = () => finish(geoError('CANCELLED', '已取消 OSM 地圖載入。'))
          const timeout = setTimeout(() => finish(geoError('SERVICE_UNAVAILABLE', 'OSM 底圖載入逾時，請確認圖資服務。')), 60000)
          currentMap.on('load', load)
          currentMap.on('error', fail)
          options.signal?.addEventListener('abort', abort, { once: true })
          if (options.signal?.aborted) abort()
          else if (currentMap.loaded()) load()
        })
        throwIfAborted(options.signal)
        const fit = (bounds: Bounds) => currentMap.fitBounds(mapLibreBounds(bounds), {
          padding: 50, maxZoom: options.maxZoom ?? 22, duration: 0,
        })
        if (options.bounds) fit(options.bounds)
        ready = true
        return {
          setMarkers(next) {
            if (destroyed) return
            validateMarkers(next)
            clearMarkers()
            try {
              for (const data of next) {
                const element = createMarkerElement(data, options.events?.onSelect)
                let marker: MapLibreMarker | undefined
                try {
                  marker = new sdk.Marker({ element: element.element })
                  marker.setLngLat([data.coordinate.longitude, data.coordinate.latitude]).addTo(currentMap)
                  mounted.push({ marker, dispose: element.dispose })
                } catch (cause) { element.dispose(); marker?.remove(); throw cause }
              }
              markers = next
            } catch (cause) { markers = []; clearMarkers(); throw toGeoError(cause) }
          },
          focus(coordinate, zoom) {
            if (destroyed) return
            validateCoordinate(coordinate)
            if (zoom !== undefined) validateZoom(zoom)
            currentMap.jumpTo({
              center: [coordinate.longitude, coordinate.latitude],
              ...(zoom === undefined ? {} : { zoom: Math.min(zoom, options.maxZoom ?? 22) }),
            })
          },
          fitBounds(bounds) {
            if (destroyed) return
            validateBounds(bounds)
            fit(bounds)
          },
          fitMarkers() {
            if (destroyed) return
            const bounds = markerBounds(markers)
            if (bounds) fit(bounds)
          },
          destroy,
        }
      } catch (cause) { destroy(); throw toGeoError(cause) }
    },
  }
}
