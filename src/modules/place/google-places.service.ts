import './google-map.css'

export interface GooglePlaceDetails {
  id: string
  displayName?: string
  formattedAddress?: string
  location?: GoogleMapPosition
  viewport?: GoogleMapViewport
  googleMapsUri?: string
}

export interface GoogleMapPosition {
  lat: number
  lng: number
}

export interface GoogleMapViewport {
  north: number
  south: number
  east: number
  west: number
}

export interface GoogleMapMarkerData {
  id: string
  title: string
  position: GoogleMapPosition
  sequence?: number
  color?: string
  enlarged?: boolean
  onClick?: () => void
}

export interface GoogleMapHandle {
  setRoute?(lines: readonly (readonly import("../../geo/contracts").Coordinate[])[]): void
  setMarkers(markers: GoogleMapMarkerData[], options?: { fitBounds?: boolean; fitMarkerIds?: readonly string[] }): void
  resetView(): void
  destroy(): void
}

export type GoogleTravelMode =
  | 'DRIVING'
  | 'TRANSIT'
  | 'WALKING'
  | 'BICYCLING'
  | 'TWO_WHEELER'

interface GooglePlace {
  id?: string
  displayName?: string
  formattedAddress?: string
  location?: {
    lat(): number
    lng(): number
  }
  viewport?: {
    getNorthEast(): { lat(): number; lng(): number }
    getSouthWest(): { lat(): number; lng(): number }
  }
  googleMapsURI?: string
  fetchFields(options: { fields: string[] }): Promise<void>
}

interface GooglePlacePrediction {
  toPlace(): GooglePlace
}

interface PlaceAutocompleteElement extends HTMLElement {
  value: string
}

interface GooglePlacesLibrary {
  PlaceAutocompleteElement: new (options?: { placeholder?: string }) => PlaceAutocompleteElement
  Place?: new (options: { id: string }) => GooglePlace
}

interface GoogleRoute {
  durationMillis?: number
  distanceMeters?: number
}

interface GoogleRoutesLibrary {
  Route: {
    computeRoutes(request: {
      origin: GooglePlace
      destination: GooglePlace
      travelMode: GoogleTravelMode
      fields: string[]
    }): Promise<{ routes?: GoogleRoute[] }>
  }
}

interface GoogleMapInstance {
  fitBounds(bounds: GoogleMapViewport | GoogleMapBounds, padding?: number): void
  setOptions(options: { center: GoogleMapPosition; zoom: number }): void
}

interface GoogleMapBounds {
  extend(position: GoogleMapPosition): GoogleMapBounds
}

interface GoogleCoreLibrary {
  LatLngBounds: new () => GoogleMapBounds
}

interface GoogleMapsLibrary {
  Map: new (
    container: HTMLElement,
    options: {
      center: GoogleMapPosition
      zoom: number
      mapId: string
      mapTypeControl: boolean
      streetViewControl: boolean
      fullscreenControl: boolean
      maxZoom?: number
    },
  ) => GoogleMapInstance
}

interface GoogleAdvancedMarker {
  map: GoogleMapInstance | null
  addEventListener(type: 'gmp-click', listener: () => void): void
  removeEventListener(type: 'gmp-click', listener: () => void): void
}

interface GoogleMarkerLibrary {
  AdvancedMarkerElement: new (options: {
    map: GoogleMapInstance
    position: GoogleMapPosition
    title: string
    content: HTMLElement
    gmpClickable: boolean
  }) => GoogleAdvancedMarker
}

interface GoogleLibraryImporter {
  (library: 'core'): Promise<GoogleCoreLibrary>
  (library: 'places'): Promise<GooglePlacesLibrary>
  (library: 'maps'): Promise<GoogleMapsLibrary>
  (library: 'marker'): Promise<GoogleMarkerLibrary>
  (library: 'routes'): Promise<GoogleRoutesLibrary>
}

interface GoogleMapsWindow extends Window {
  __travelPlannerGoogleMapsReady?: () => void
  google?: {
    maps?: {
      importLibrary: GoogleLibraryImporter
    }
  }
}

interface PlaceSelectEvent extends Event {
  placePrediction?: GooglePlacePrediction
}

let placesLibraryPromise: Promise<GooglePlacesLibrary> | undefined

export function isGooglePlacesConfigured(): boolean {
  return Boolean(import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim())
}

async function loadPlacesLibrary(): Promise<GooglePlacesLibrary> {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('尚未設定 Google Maps API key。請在 .env.local 設定 VITE_GOOGLE_MAPS_API_KEY。')
  }

  if (!placesLibraryPromise) {
    placesLibraryPromise = new Promise<void>((resolve, reject) => {
      const mapsWindow = window as GoogleMapsWindow
      if (mapsWindow.google?.maps?.importLibrary) {
        resolve()
        return
      }

      const callbackName = '__travelPlannerGoogleMapsReady'
      const script = document.createElement('script')
      const url = new URL('https://maps.googleapis.com/maps/api/js')
      url.searchParams.set('key', apiKey)
      url.searchParams.set('v', 'weekly')
      url.searchParams.set('loading', 'async')
      url.searchParams.set('libraries', 'places')
      url.searchParams.set('callback', callbackName)
      script.src = url.toString()
      script.async = true
      mapsWindow[callbackName] = () => {
        delete mapsWindow[callbackName]
        resolve()
      }
      script.onerror = () => {
        delete mapsWindow[callbackName]
        script.remove()
        reject(new Error('Google Maps JavaScript API 載入失敗，請檢查 API key 和 API 限制。'))
      }
      document.head.append(script)
    }).then(async () => {
      const mapsWindow = window as GoogleMapsWindow
      const importLibrary = mapsWindow.google?.maps?.importLibrary
      if (!importLibrary) {
        throw new Error('Google Maps JavaScript API 已載入，但 Places Library 無法使用。')
      }
      return importLibrary('places')
    }).catch((cause: unknown) => {
      placesLibraryPromise = undefined
      throw cause
    })
  }

  return placesLibraryPromise
}

function toDetails(place: GooglePlace): GooglePlaceDetails {
  if (!place.id) {
    throw new Error('Google Places 沒有回傳 place ID，請重新選擇搜尋結果。')
  }
  return {
    id: place.id,
    ...(place.displayName ? { displayName: place.displayName } : {}),
    ...(place.formattedAddress ? { formattedAddress: place.formattedAddress } : {}),
    ...(place.location
      ? { location: { lat: place.location.lat(), lng: place.location.lng() } }
      : {}),
    ...(place.viewport
      ? {
          viewport: {
            north: place.viewport.getNorthEast().lat(),
            east: place.viewport.getNorthEast().lng(),
            south: place.viewport.getSouthWest().lat(),
            west: place.viewport.getSouthWest().lng(),
          },
        }
      : {}),
    ...(place.googleMapsURI ? { googleMapsUri: place.googleMapsURI } : {}),
  }
}

export async function mountPlaceAutocomplete(
  container: HTMLElement,
  onSelect: (details: GooglePlaceDetails, query: string) => void,
  onError: (error: Error) => void,
  options: { label?: string; onInput?: () => void } = {},
): Promise<() => void> {
  const library = await loadPlacesLibrary()
  const autocomplete = new library.PlaceAutocompleteElement({
    placeholder: '輸入地址、店名或景點名稱',
  })
  autocomplete.setAttribute('aria-label', options.label ?? '搜尋 Google Maps 地點')
  let active = true
  let selection = 0
  const handleInput = () => {
    selection += 1
    options.onInput?.()
  }

  const handleSelect = async (rawEvent: Event) => {
    const prediction = (rawEvent as PlaceSelectEvent).placePrediction
    if (!prediction) return

    const query = autocomplete.value.trim()
    const currentSelection = ++selection
    options.onInput?.()
    try {
      const place = prediction.toPlace()
      await place.fetchFields({
        fields: ['id', 'displayName', 'formattedAddress', 'location', 'viewport', 'googleMapsURI'],
      })
      if (active && selection === currentSelection) onSelect(toDetails(place), query)
    } catch (cause) {
      if (active && selection === currentSelection) {
        onError(cause instanceof Error ? cause : new Error('讀取 Google 地點資料失敗。'))
      }
    }
  }

  autocomplete.addEventListener('gmp-select', handleSelect)
  autocomplete.addEventListener('input', handleInput)
  container.replaceChildren(autocomplete)
  return () => {
    active = false
    autocomplete.removeEventListener('gmp-select', handleSelect)
    autocomplete.removeEventListener('input', handleInput)
    autocomplete.remove()
  }
}

export async function getGooglePlaceDetails(placeId: string): Promise<GooglePlaceDetails> {
  const library = await loadPlacesLibrary()
  const Place = library.Place
  if (!Place) {
    throw new Error('Google Places Details 無法使用，請確認 Places API (New) 已啟用。')
  }

  const place = new Place({ id: placeId })
  await place.fetchFields({
    fields: ['id', 'displayName', 'formattedAddress', 'location', 'viewport', 'googleMapsURI'],
  })
  return toDetails(place)
}

export interface GoogleRouteEstimate {
  durationMinutes: number
  distanceMeters: number
}

export async function getGoogleRouteEstimate(
  originPlaceId: string,
  destinationPlaceId: string,
  travelMode: GoogleTravelMode,
): Promise<GoogleRouteEstimate> {
  const placesLibrary = await loadPlacesLibrary()
  const Place = placesLibrary.Place
  if (!Place) {
    throw new Error('Google Places Details 無法使用，請確認 Places API (New) 已啟用。')
  }
  const mapsWindow = window as GoogleMapsWindow
  const importLibrary = mapsWindow.google?.maps?.importLibrary
  if (!importLibrary) {
    throw new Error('Google Maps JavaScript API 尚未就緒，無法計算路線。')
  }
  const routesLibrary = await importLibrary('routes')
  const result = await routesLibrary.Route.computeRoutes({
    origin: new Place({ id: originPlaceId }),
    destination: new Place({ id: destinationPlaceId }),
    travelMode,
    fields: ['durationMillis', 'distanceMeters'],
  })
  const durationMillis = result.routes?.[0]?.durationMillis
  if (durationMillis === undefined || !Number.isFinite(durationMillis) || durationMillis < 0) {
    throw new Error('Google Maps 找不到這兩個地點之間可用的路線時間。')
  }
  const distanceMeters = result.routes?.[0]?.distanceMeters
  if (distanceMeters === undefined || !Number.isSafeInteger(distanceMeters) || distanceMeters < 0) {
    throw new Error('Google Maps 未回傳有效的路線距離，請重新計算路程。')
  }
  return { durationMinutes: Math.ceil(durationMillis / 60_000), distanceMeters }
}

export async function mountGoogleMap(
  container: HTMLElement,
  options: {
    center: GoogleMapPosition
    zoom: number
    viewport?: GoogleMapViewport
    maxZoom?: number
  },
): Promise<GoogleMapHandle> {
  await loadPlacesLibrary()
  const mapsWindow = window as GoogleMapsWindow
  const importLibrary = mapsWindow.google?.maps?.importLibrary
  if (!importLibrary) {
    throw new Error('Google Maps JavaScript API 已載入，但 Maps Library 無法使用。')
  }

  const [mapsLibrary, markerLibrary, coreLibrary] = await Promise.all([
    importLibrary('maps'),
    importLibrary('marker'),
    importLibrary('core'),
  ])
  const map = new mapsLibrary.Map(container, {
    center: options.center,
    zoom: options.zoom,
    mapId: 'DEMO_MAP_ID',
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
    ...(options.maxZoom !== undefined ? { maxZoom: options.maxZoom } : {}),
  })
  if (options.viewport) map.fitBounds(options.viewport)

  const mountedMarkers = new Map<
    string,
    { marker: GoogleAdvancedMarker; clickHandler?: () => void }
  >()

  return {
    resetView() {
      if (options.viewport) map.fitBounds(options.viewport)
      else map.setOptions({ center: options.center, zoom: options.zoom })
    },
    setMarkers(markers, options) {
      for (const { marker, clickHandler } of mountedMarkers.values()) {
        if (clickHandler) marker.removeEventListener('gmp-click', clickHandler)
        marker.map = null
      }
      mountedMarkers.clear()

      for (const markerData of markers) {
        const content = document.createElement('div')
        content.className = markerData.sequence === undefined
          ? 'google-map-marker'
          : 'google-map-marker google-map-marker-numbered'
        content.textContent = markerData.sequence === undefined
          ? ''
          : String(markerData.sequence)
        if (markerData.color) content.style.backgroundColor = markerData.color
        if (markerData.enlarged) content.className += ' google-map-marker-enlarged'
        const clickHandler = markerData.onClick
        const marker = new markerLibrary.AdvancedMarkerElement({
          map,
          position: markerData.position,
          title: markerData.title,
          content,
          gmpClickable: Boolean(clickHandler),
        })
        if (clickHandler) marker.addEventListener('gmp-click', clickHandler)
        mountedMarkers.set(markerData.id, { marker, clickHandler })
      }
      if (options?.fitBounds) {
        const ids = options.fitMarkerIds && new Set(options.fitMarkerIds)
        const fitted = ids ? markers.filter(marker => ids.has(marker.id)) : markers
        if (fitted.length) {
          const bounds = new coreLibrary.LatLngBounds()
          for (const marker of fitted) bounds.extend(marker.position)
          map.fitBounds(bounds, 50)
        }
      }
    },
    destroy() {
      for (const { marker, clickHandler } of mountedMarkers.values()) {
        if (clickHandler) marker.removeEventListener('gmp-click', clickHandler)
        marker.map = null
      }
      mountedMarkers.clear()
    },
  }
}
