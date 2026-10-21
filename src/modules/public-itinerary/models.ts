import type { ItineraryItem, Place, Region, Trip } from '../../database/models'

// Public snapshots share the production personal field definitions.
export type { ItineraryItem, Label, Place, PlaceIcon, Region, Trip } from '../../database/models'

export type PublicPlace = Omit<Place, 'notes' | 'labelIds'>

export interface PublicSnapshot {
  schemaVersion: 1
  region: Region
  trip: Trip
  places: PublicPlace[]
  items: ItineraryItem[]
}

export interface PublicItinerary {
  id: string
  sourceTripId: string
  createdAt: string
  updatedAt: string | null
  snapshot: PublicSnapshot
}

export interface PublicListQuery {
  search?: string
  regionName?: string
}

export type SharingErrorCode =
  | 'NOT_IMPLEMENTED'
  | 'SOURCE_NOT_FOUND'
  | 'PUBLIC_NOT_FOUND'
  | 'SOURCE_MISMATCH'
  | 'ALREADY_PUBLISHED'
  | 'INVALID_SOURCE'

export class SharingError extends Error {
  readonly code: SharingErrorCode

  constructor(code: SharingErrorCode) {
    super(code)
    this.name = 'SharingError'
    this.code = code
  }
}

export interface PublicItineraryCore {
  list(query?: PublicListQuery): Promise<PublicItinerary[]>
  readSnapshot(publicId: string): Promise<PublicSnapshot>
  findBySource(sourceTripId: string): Promise<PublicItinerary | undefined>
  publish(sourceTripId: string): Promise<PublicItinerary>
  update(publicId: string, sourceTripId: string): Promise<PublicItinerary>
  withdraw(publicId: string, sourceTripId: string): Promise<void>
  apply(publicId: string): Promise<Trip>
}
