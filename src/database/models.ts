import type { LocationMetadata, RouteEndpointSelection, StoredLocation } from '../geo/contracts'

export interface Region {
  id: string
  name: string
  mapProvider?: 'google' | 'osm'
  osmDataset?: import('../geo/osm-datasets').OsmDatasetId
  center?: {
    latitude: number
    longitude: number
  }
  googlePlaceId?: string
  centerMetadata?: LocationMetadata
  zoom: number
}

export interface Place {
  id: string
  name: string
  icon?: PlaceIcon
  mapsUrl?: string
  googlePlaceId?: string
  location?: StoredLocation
  notes?: string
  regionIds: string[]
  labelIds: string[]
}

export const placeIcons = [
  '🍜',
  '🍽️',
  '☕',
  '🍰',
  '🏨',
  '🏠',
  '⛩️',
  '🏛️',
  '🏰',
  '🏞️',
  '🌳',
  '🏖️',
  '⛰️',
  '🎡',
  '🛍️',
  '🎨',
  '🎭',
  '📷',
  '🚉',
  '✈️',
  '🚗',
  '♨️',
] as const

export type PlaceIcon = (typeof placeIcons)[number]

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
  travelDistanceMeters?: number
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

export interface RouteMap {
  id: string
  name: string
  tripId?: string
  selectedDate?: string
  originGooglePlaceId?: string
  destinationGooglePlaceId?: string
  origin?: RouteEndpointSelection
  destination?: RouteEndpointSelection
  transport: string
}

export interface RouteMapPlace {
  id: string
  routeMapId: string
  googlePlaceId?: string
  location?: StoredLocation
  name?: string
}

export type NewRouteMap = Omit<RouteMap, 'id'>
export type RouteMapChanges = Partial<NewRouteMap>
export type NewRouteMapPlace = Omit<RouteMapPlace, 'id'>
export type RouteMapPlaceChanges = Partial<NewRouteMapPlace>
export type ItineraryItemChanges = Partial<NewItineraryItem>
