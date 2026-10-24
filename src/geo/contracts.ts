export type GeoProvider = 'google' | 'osm'

export interface Coordinate {
  readonly latitude: number
  readonly longitude: number
}

export interface Bounds {
  readonly north: number
  readonly south: number
  readonly east: number
  readonly west: number
}

export interface GooglePlaceReference {
  readonly provider: 'google'
  readonly id: string
}

export interface OsmPlaceReference {
  readonly provider: 'osm'
  readonly id: `${'node' | 'way' | 'relation'}/${string}`
}

export type ProviderReference = GooglePlaceReference | OsmPlaceReference

export type LocationKind = 'point' | 'approximate-center' | 'map-center' | 'user-picked'

export type LocationMetadata =
  | {
    readonly source: 'user' | 'legacy-user'
    readonly kind: LocationKind
  }
  | {
    readonly source: 'osm'
    readonly kind: LocationKind
    readonly reference: OsmPlaceReference
    readonly datasetVersion?: string
  }

export type StoredLocation = LocationMetadata & {
  readonly coordinate: Coordinate
}

export interface GoogleRuntimeLocation {
  readonly source: 'google'
  readonly kind: LocationKind
  readonly reference: GooglePlaceReference
  readonly coordinate: Coordinate
}

export interface LocationResolution {
  readonly location: StoredLocation | GoogleRuntimeLocation
  readonly coverage: 'inside' | 'outside' | 'unknown'
  readonly warnings: readonly string[]
}

export interface MapMarker {
  readonly id: string
  readonly name: string
  readonly coordinate: Coordinate
  readonly sequence?: number
  readonly color?: string
  readonly selected?: boolean
}

export interface MapEvents {
  readonly onSelect?: (markerId: string) => void
  readonly onError?: (error: GeoError) => void
}

export interface MapMountOptions {
  readonly center: Coordinate
  readonly zoom: number
  readonly bounds?: Bounds
  readonly maxZoom?: number
  readonly events?: MapEvents
  readonly signal?: AbortSignal
}

export interface MapHandle {
  setRoute?(lines: readonly (readonly Coordinate[])[]): void
  setMarkers(markers: readonly MapMarker[]): void
  focus(coordinate: Coordinate, zoom?: number): void
  fitBounds(bounds: Bounds): void
  fitMarkers(): void
  destroy(): void
}

export interface MapRenderer {
  mount(host: HTMLElement, options: MapMountOptions): Promise<MapHandle>
}

export interface GeoRequestOptions {
  readonly signal?: AbortSignal
}

export interface LocationCandidate {
  readonly key: string
  readonly reference: ProviderReference
  readonly name?: string
  readonly address?: string
  readonly resolution?: LocationResolution
}

export type SearchResult =
  | {
    readonly kind: 'candidates'
    readonly candidates: readonly [LocationCandidate, ...LocationCandidate[]]
    readonly total?: number
    readonly suggestion?: string
  }
  | {
    readonly kind: 'no-results'
    readonly candidates: readonly []
    readonly suggestion?: string
  }

export interface LocationSearch {
  search(query: string, options?: GeoRequestOptions): Promise<SearchResult>
}

export interface LocationResolver {
  resolve(reference: ProviderReference, options?: GeoRequestOptions): Promise<LocationResolution>
}

export type TravelMode = 'DRIVING' | 'WALKING' | 'BICYCLING' | 'TRANSIT' | 'TWO_WHEELER'

export interface ResolvedRouteEndpoint {
  readonly id: string
  readonly name: string
  readonly resolution: LocationResolution
}

export interface RouteRequest {
  readonly origin: ResolvedRouteEndpoint
  readonly destination: ResolvedRouteEndpoint
  readonly mode: TravelMode
}

export interface RouteEstimate {
  readonly durationMinutes: number
  readonly distanceMeters: number
  readonly provider: GeoProvider
  readonly estimated: boolean
  readonly datasetVersion?: string
  readonly warnings: readonly string[]
}

export interface Routing {
  estimate(request: RouteRequest, options?: GeoRequestOptions): Promise<RouteEstimate>
}

export type RouteEndpointSelection =
  | { readonly kind: 'place'; readonly placeId: string }
  | { readonly kind: 'shared-place'; readonly tripId: string; readonly placeId: string }
  | { readonly kind: 'route-map-place'; readonly routeMapPlaceId: string }
  | {
    readonly kind: 'location'
    readonly id: string
    readonly value:
      | { readonly kind: 'stored'; readonly name: string; readonly location: StoredLocation }
      | { readonly kind: 'google'; readonly name?: string; readonly reference: GooglePlaceReference }
  }

export type GeoAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: string }

export interface GeoCapabilities {
  readonly map: GeoAvailability
  readonly search: GeoAvailability
  readonly resolve: GeoAvailability
  readonly routing: GeoAvailability
  readonly travelModes: readonly TravelMode[]
}

export interface GeoDataset {
  readonly id: string
  readonly version?: string
  readonly bounds: Bounds
  readonly center: Coordinate
  readonly zoom: number
}

export interface GeoServices {
  readonly provider: GeoProvider
  readonly capabilities: GeoCapabilities
  readonly dataset?: GeoDataset
  readonly renderer: MapRenderer
  readonly search: LocationSearch
  readonly resolver: LocationResolver
  readonly routing: Routing
}

export type GeoErrorCode =
  | 'INVALID_INPUT'
  | 'UNSUPPORTED_INPUT'
  | 'UNSUPPORTED_MODE'
  | 'OUTSIDE_COVERAGE'
  | 'NETWORK_REQUIRED'
  | 'SERVICE_UNAVAILABLE'
  | 'DATASET_MISMATCH'
  | 'LOCATION_UNAVAILABLE'
  | 'PROVIDER_RESTRICTED'
  | 'NO_ROUTE'
  | 'CANCELLED'

export interface GeoError extends Error {
  readonly code: GeoErrorCode
}
