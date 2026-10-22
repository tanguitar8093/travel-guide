import type { Coordinate, MapMarker, MapRenderer } from '../../contracts'
import { geoError, throwIfAborted, toGeoError, withAbort } from '../../errors'
import { markerBounds, validateBounds, validateCoordinate, validateMarkers, validateMountOptions, validateZoom } from '../../map-validation'
import { createMarkerElement } from '../../marker-element'
import type { GoogleMarkerInstance, GoogleRendererSdk } from './google-sdk'

const position = (coordinate: Coordinate) => ({ lat: coordinate.latitude, lng: coordinate.longitude })

export function createGoogleRenderer(loadSdk: () => Promise<GoogleRendererSdk>): MapRenderer {
  return {
    async mount(host, options) {
      validateMountOptions(options)
      throwIfAborted(options.signal)
      const sdk = await withAbort(loadSdk(), options.signal)
      throwIfAborted(options.signal)
      const container = document.createElement('div')
      container.className = 'geo-renderer-host'
      host.append(container)
      let map: InstanceType<GoogleRendererSdk['Map']> | undefined
      let destroyed = false
      let ready = false
      let sdkError: Error | undefined
      let failMount: ((error: Error) => void) | undefined
      let unsubscribeErrors: (() => void) | undefined
      let markers: readonly MapMarker[] = []
      let mounted: { marker: GoogleMarkerInstance; dispose(): void }[] = []
      const clearMarkers = () => {
        for (const item of mounted) { item.dispose(); item.marker.map = null }
        mounted = []
      }
      const destroy = () => {
        if (destroyed) return
        destroyed = true
        unsubscribeErrors?.()
        clearMarkers()
        if (map) sdk.clearInstanceListeners(map)
        container.remove()
      }
      try {
        unsubscribeErrors = sdk.subscribeErrors?.(error => {
          if (destroyed) return
          sdkError = error
          if (!ready) failMount?.(error)
          else if (options.events?.onError) options.events.onError(toGeoError(error))
          else console.error('Google renderer error', error)
        })
        if (sdkError) throw sdkError
        map = new sdk.Map(container, {
          center: position(options.center), zoom: Math.min(options.zoom, options.maxZoom ?? 22),
          maxZoom: options.maxZoom, mapId: 'DEMO_MAP_ID', mapTypeControl: false, streetViewControl: false,
        })
        const currentMap = map
        await new Promise<void>((resolve, reject) => {
          const finish = (error?: Error) => {
            failMount = undefined
            clearTimeout(timeout)
            listener.remove()
            options.signal?.removeEventListener('abort', abort)
            if (error) reject(error); else resolve()
          }
          const abort = () => finish(geoError('CANCELLED', '已取消 Google 地圖載入。'))
          const timeout = setTimeout(() => finish(geoError('SERVICE_UNAVAILABLE', 'Google 底圖載入逾時，請確認 API key、網路與授權。')), 20000)
          const listener = currentMap.addListener('idle', () => finish())
          failMount = error => finish(error)
          options.signal?.addEventListener('abort', abort, { once: true })
          if (sdkError) finish(sdkError)
          else if (options.signal?.aborted) abort()
          else if (options.bounds) currentMap.fitBounds(options.bounds, 50)
        })
        throwIfAborted(options.signal)
        if (sdkError) throw sdkError
        ready = true
        return {
          setMarkers(next) {
            if (destroyed) return
            validateMarkers(next)
            clearMarkers()
            try {
              for (const data of next) {
                const element = createMarkerElement(data, options.events?.onSelect)
                try {
                  const marker = new sdk.AdvancedMarkerElement({
                    map: currentMap, position: position(data.coordinate), content: element.element, title: data.name,
                  })
                  mounted.push({ marker, dispose: element.dispose })
                } catch (cause) { element.dispose(); throw cause }
              }
              markers = next
            } catch (cause) { markers = []; clearMarkers(); throw toGeoError(cause) }
          },
          focus(coordinate, zoom) {
            if (destroyed) return
            validateCoordinate(coordinate)
            if (zoom !== undefined) validateZoom(zoom)
            currentMap.setCenter(position(coordinate))
            if (zoom !== undefined) currentMap.setZoom(Math.min(zoom, options.maxZoom ?? 22))
          },
          fitBounds(bounds) {
            if (destroyed) return
            validateBounds(bounds)
            currentMap.fitBounds(bounds, 50)
          },
          fitMarkers() {
            if (destroyed) return
            const bounds = markerBounds(markers)
            if (bounds) currentMap.fitBounds(bounds, 50)
          },
          destroy,
        }
      } catch (cause) { destroy(); throw toGeoError(cause) }
    },
  }
}
