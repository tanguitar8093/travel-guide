import { geoError } from '../../errors'

export interface GoogleMapInstance {
  setCenter(position: { lat: number; lng: number }): void
  setZoom(zoom: number): void
  fitBounds(bounds: { north: number; south: number; east: number; west: number }, padding: number): void
  addListener(event: 'idle', listener: () => void): { remove(): void }
}

export interface GoogleMarkerInstance {
  map: GoogleMapInstance | null
}

export interface GoogleRendererSdk {
  Map: new (host: HTMLElement, options: {
    center: { lat: number; lng: number }; zoom: number; maxZoom?: number
    mapId: string; mapTypeControl: boolean; streetViewControl: boolean
  }) => GoogleMapInstance
  AdvancedMarkerElement: new (options: {
    map: GoogleMapInstance; position: { lat: number; lng: number }; content: HTMLElement; title: string
  }) => GoogleMarkerInstance
  clearInstanceListeners(instance: GoogleMapInstance): void
  subscribeErrors?(listener: (error: Error) => void): () => void
}

interface GoogleApi {
  importLibrary(name: 'maps'): Promise<{ Map: GoogleRendererSdk['Map'] }>
  importLibrary(name: 'marker'): Promise<{ AdvancedMarkerElement: GoogleRendererSdk['AdvancedMarkerElement'] }>
  event: { clearInstanceListeners(instance: GoogleMapInstance): void }
}

type GoogleWindow = Window & { google?: { maps?: GoogleApi }; gm_authFailure?: () => void }

export function createGoogleSdkLoader(apiKey: string): () => Promise<GoogleRendererSdk> {
  let pending: Promise<GoogleRendererSdk> | undefined
  let authFailure: Error | undefined
  let authHandlerInstalled = false
  const errorListeners = new Set<(error: Error) => void>()
  return () => {
    if (pending) return pending
    if (!apiKey.trim()) return Promise.reject(geoError('SERVICE_UNAVAILABLE', '未設定 Google Maps API key，無法載入 Google 底圖。'))
    const load = async () => {
      const target = window as GoogleWindow
      if (!authHandlerInstalled) {
        const previousAuthFailure = target.gm_authFailure
        target.gm_authFailure = () => {
          authFailure = geoError('SERVICE_UNAVAILABLE', 'Google Maps 授權失敗，請確認 API key、允許的網站來源與帳務設定。')
          for (const listener of errorListeners) listener(authFailure)
          previousAuthFailure?.()
        }
        authHandlerInstalled = true
      }
      if (!target.google?.maps?.importLibrary) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script')
          const timeout = setTimeout(() => finish(geoError('SERVICE_UNAVAILABLE', 'Google Maps SDK 載入逾時。')), 20000)
          const finish = (error?: Error) => {
            clearTimeout(timeout)
            Reflect.deleteProperty(window, callbackName)
            script.onload = null
            script.onerror = null
            if (error) { script.remove(); reject(error) } else resolve()
          }
          const url = new URL('https://maps.googleapis.com/maps/api/js')
          const callbackName = `__travelGeoGoogleReady${crypto.randomUUID().replaceAll('-', '')}`
          Reflect.defineProperty(window, callbackName, { configurable: true, value: () => finish() })
          url.searchParams.set('key', apiKey)
          url.searchParams.set('v', 'weekly')
          url.searchParams.set('loading', 'async')
          url.searchParams.set('callback', callbackName)
          script.src = url.toString()
          script.async = true
          script.onerror = () => finish(geoError('SERVICE_UNAVAILABLE', 'Google Maps SDK 載入失敗，請確認網路與 API 限制。'))
          document.head.append(script)
        })
      }
      const api = target.google?.maps
      if (!api?.importLibrary) throw geoError('SERVICE_UNAVAILABLE', 'Google Maps SDK 未提供 importLibrary。')
      const [maps, markers] = await Promise.all([api.importLibrary('maps'), api.importLibrary('marker')])
      return {
        Map: maps.Map,
        AdvancedMarkerElement: markers.AdvancedMarkerElement,
        clearInstanceListeners: (instance: GoogleMapInstance) => api.event.clearInstanceListeners(instance),
        subscribeErrors: (listener: (error: Error) => void) => {
          errorListeners.add(listener)
          if (authFailure) listener(authFailure)
          return () => { errorListeners.delete(listener) }
        },
      }
    }
    pending = load().catch(cause => { pending = undefined; throw cause })
    return pending
  }
}
