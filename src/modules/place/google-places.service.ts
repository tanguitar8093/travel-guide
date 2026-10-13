export interface GooglePlaceDetails {
  id: string
  displayName?: string
  formattedAddress?: string
  latitude?: number
  longitude?: number
  googleMapsUri?: string
}

interface GooglePlace {
  id?: string
  displayName?: string
  formattedAddress?: string
  location?: {
    lat(): number
    lng(): number
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
}

interface GoogleMapsWindow extends Window {
  __travelPlannerGoogleMapsReady?: () => void
  google?: {
    maps?: {
      importLibrary(library: 'places'): Promise<GooglePlacesLibrary>
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
      ? { latitude: place.location.lat(), longitude: place.location.lng() }
      : {}),
    ...(place.googleMapsURI ? { googleMapsUri: place.googleMapsURI } : {}),
  }
}

export async function mountPlaceAutocomplete(
  container: HTMLElement,
  onSelect: (details: GooglePlaceDetails, query: string) => void,
  onError: (error: Error) => void,
): Promise<() => void> {
  const library = await loadPlacesLibrary()
  const autocomplete = new library.PlaceAutocompleteElement({
    placeholder: '輸入地址、店名或景點名稱',
  })
  autocomplete.setAttribute('aria-label', '搜尋 Google Maps 地點')

  const handleSelect = async (rawEvent: Event) => {
    const prediction = (rawEvent as PlaceSelectEvent).placePrediction
    if (!prediction) return

    const query = autocomplete.value.trim()
    try {
      const place = prediction.toPlace()
      await place.fetchFields({
        fields: ['id', 'displayName', 'formattedAddress', 'location', 'googleMapsURI'],
      })
      onSelect(toDetails(place), query)
    } catch (cause) {
      onError(cause instanceof Error ? cause : new Error('讀取 Google 地點資料失敗。'))
    }
  }

  autocomplete.addEventListener('gmp-select', handleSelect)
  container.replaceChildren(autocomplete)
  return () => {
    autocomplete.removeEventListener('gmp-select', handleSelect)
    autocomplete.remove()
  }
}

export async function getGooglePlaceDetails(placeId: string): Promise<GooglePlaceDetails> {
  const library = await loadPlacesLibrary()
  const Place = (library as GooglePlacesLibrary & {
    Place: new (options: { id: string }) => GooglePlace
  }).Place
  if (!Place) {
    throw new Error('Google Places Details 無法使用，請確認 Places API (New) 已啟用。')
  }

  const place = new Place({ id: placeId })
  await place.fetchFields({
    fields: ['id', 'displayName', 'formattedAddress', 'location', 'googleMapsURI'],
  })
  return toDetails(place)
}
