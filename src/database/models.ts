export interface Region {
  id: string
  name: string
  center?: {
    latitude: number
    longitude: number
  }
  googlePlaceId?: string
  zoom: number
}

export interface Place {
  id: string
  name: string
  mapsUrl?: string
  googlePlaceId?: string
  notes?: string
  regionIds: string[]
  labelIds: string[]
}

export interface Label {
  id: string
  name: string
  color: string
  parentId?: string
}

export interface Trip {
  id: string
  regionId: string
  name: string
  startDate: string
  endDate: string
}

export interface ItineraryItem {
  id: string
  tripId: string
  placeId: string
  date: string
  arrivalTime?: string
  durationMinutes?: number
  transport?: string
  travelDurationMinutes?: number
  note?: string
  order: number
}

export type NewRegion = Omit<Region, 'id'>
export type NewPlace = Omit<Place, 'id'>
export type NewLabel = Omit<Label, 'id'>
export type NewTrip = Omit<Trip, 'id'>
export type NewItineraryItem = Omit<ItineraryItem, 'id'>

export type RegionChanges = Partial<NewRegion>
export type PlaceChanges = Partial<NewPlace>
export type LabelChanges = Partial<NewLabel>
export type TripChanges = Partial<NewTrip>
export type ItineraryItemChanges = Partial<NewItineraryItem>
