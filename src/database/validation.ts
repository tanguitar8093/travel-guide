import { ValidationError } from './errors'
import { placeIcons } from './models'
import { validateCoordinatePair, validateLocationMetadata, validateStoredLocation } from './location.validation'
import { getRouteMapEndpoint, routeEndpointKey } from './route-endpoint'
import { isInsideOkinawaOsmCoverage } from '../geo/osm-coverage'
import type {
  ItineraryItem,
  Label,
  Place,
  Region,
  Trip,
  NewRouteMap,
  NewRouteMapPlace,
} from './models'

export function validateRouteMap(map: NewRouteMap): void {
  requireText(map.name, 'Route map name')
  if (map.tripId !== undefined) requireText(map.tripId, 'Trip ID')
  if (map.selectedDate !== undefined) requireDate(map.selectedDate, 'Selected date')
  if (map.originGooglePlaceId !== undefined) requireText(map.originGooglePlaceId, 'Origin Google Place ID')
  if (map.destinationGooglePlaceId !== undefined) requireText(map.destinationGooglePlaceId, 'Destination Google Place ID')
  if (map.originGooglePlaceId && map.originGooglePlaceId === map.destinationGooglePlaceId) {
    throw new ValidationError('Route endpoints must be different.')
  }
  const origin = getRouteMapEndpoint({ ...map, id: 'validation' }, 'origin')
  const destination = getRouteMapEndpoint({ ...map, id: 'validation' }, 'destination')
  if (origin && destination && routeEndpointKey(origin) === routeEndpointKey(destination)) {
    throw new ValidationError('Route endpoints must be different.')
  }
  if (!['DRIVING', 'TRANSIT', 'WALKING', 'BICYCLING', 'TWO_WHEELER'].includes(map.transport)) {
    throw new ValidationError('Route map transport is invalid.')
  }
}

export function validateRouteMapPlace(place: NewRouteMapPlace): void {
  requireText(place.routeMapId, 'Route map ID')
  if (place.googlePlaceId !== undefined) requireText(place.googlePlaceId, 'Google Place ID')
  if (place.location !== undefined) {
    validateStoredLocation(place.location)
    requireText(place.name, 'Route map place name')
  }
  if (place.googlePlaceId === undefined && place.location === undefined) {
    throw new ValidationError('Route map place requires a Google ID or stored location.')
  }
  if (place.name !== undefined) requireText(place.name, 'Route map place name')
}

function requireText(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`${field} must not be empty.`)
  }
}

function requireDate(value: string, field: string): void {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(timestamp) ||
      new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new ValidationError(`${field} must be a valid YYYY-MM-DD date.`)
  }
}

function requireIds(ids: string[], field: string): void {
  if (!Array.isArray(ids)) {
    throw new ValidationError(`${field} must be an array of IDs.`)
  }
  for (const id of ids) {
    requireText(id, `${field} entry`)
  }
}

export function validateRegion(
  region: Omit<Region, 'id' | 'center' | 'centerMetadata'> & { center?: unknown; centerMetadata?: unknown },
): void {
  requireText(region.name, 'Region name')
  if (region.mapProvider !== undefined && !['google', 'osm'].includes(region.mapProvider)) {
    throw new ValidationError('Region map provider is invalid.')
  }
  if (region.googlePlaceId !== undefined) {
    requireText(region.googlePlaceId, 'Google Place ID')
  }
  if (region.center !== undefined) {
    if (typeof region.center !== 'object' || region.center === null || Array.isArray(region.center) ||
        !('latitude' in region.center) || !('longitude' in region.center)) {
      throw new ValidationError('Region center must be a coordinate pair.')
    }
    validateCoordinatePair(region.center.latitude, region.center.longitude)
  } else if (region.googlePlaceId === undefined) {
    throw new ValidationError('Select a Google Maps place for the region.')
  }

  if (region.centerMetadata !== undefined) {
    validateLocationMetadata(region.centerMetadata)
    if (region.center === undefined) {
      throw new ValidationError('Region center metadata requires a center.')
    }
  }

  if (region.mapProvider === 'osm') {
    if (region.googlePlaceId !== undefined || !region.center || !region.centerMetadata) {
      throw new ValidationError('OSM regions require an OSM-owned center and cannot use a Google place ID.')
    }
    if (!isInsideOkinawaOsmCoverage(region.center)) {
      throw new ValidationError('OSM region center is outside the current Okinawa dataset coverage.')
    }
  }

  if (!Number.isFinite(region.zoom) || region.zoom < 0 || region.zoom > 22) {
    throw new ValidationError('Region zoom must be between 0 and 22.')
  }
}

export function validatePlaceRegionProviders(
  place: Pick<Place, 'googlePlaceId' | 'location' | 'regionIds'>,
  regions: readonly Region[],
): void {
  const linkedRegions = regions.filter(region => place.regionIds.includes(region.id))
  if (place.location) {
    if (place.googlePlaceId !== undefined) {
      throw new ValidationError('A place cannot use Google and OSM locations at the same time.')
    }
    if (!place.regionIds.length || linkedRegions.some(region => region.mapProvider !== 'osm')) {
      throw new ValidationError('OSM locations must belong only to an OSM region.')
    }
    if (!isInsideOkinawaOsmCoverage(place.location.coordinate)) {
      throw new ValidationError('OSM locations are limited to the current Okinawa dataset coverage.')
    }
  } else if (place.googlePlaceId && linkedRegions.some(region => region.mapProvider === 'osm')) {
    throw new ValidationError('Google Places must belong only to a Google region.')
  }
}

export function validatePlace(place: Omit<Place, 'id'>): void {
  requireText(place.name, 'Place name')
  if (place.location !== undefined) validateStoredLocation(place.location)
  if (
    place.icon !== undefined &&
    !placeIcons.some((icon) => icon === place.icon)
  ) {
    throw new ValidationError('Place icon is not supported.')
  }
  if (place.googlePlaceId !== undefined) {
    requireText(place.googlePlaceId, 'Google Place ID')
  }
  requireIds(place.regionIds, 'regionIds')
  requireIds(place.labelIds, 'labelIds')

  if (place.notes !== undefined && typeof place.notes !== 'string') {
    throw new ValidationError('Place notes must be text.')
  }

  if (place.mapsUrl !== undefined) {
    requireText(place.mapsUrl, 'Maps URL')
    let url: URL
    try {
      url = new URL(place.mapsUrl)
    } catch {
      throw new ValidationError('Maps URL must be a valid absolute URL.')
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new ValidationError('Maps URL must use HTTP or HTTPS.')
    }
  }

  if (place.googlePlaceId === undefined && place.mapsUrl === undefined && place.location === undefined) {
    throw new ValidationError('Select a Google Maps place, provide a map URL or a stored location.')
  }
}

export function validateLabel(label: Omit<Label, 'id'>): void {
  requireText(label.name, 'Label name')
  requireText(label.color, 'Label color')
  if (label.parentId !== undefined) {
    requireText(label.parentId, 'Parent label ID')
  }
}

export function validateTrip(trip: Omit<Trip, 'id'>): void {
  requireText(trip.name, 'Trip name')
  requireText(trip.regionId, 'Trip region ID')
  requireDate(trip.startDate, 'Trip startDate')
  requireDate(trip.endDate, 'Trip endDate')

  if (trip.endDate < trip.startDate) {
    throw new ValidationError('Trip endDate must be on or after startDate.')
  }
}

export function validateItineraryItem(item: Omit<ItineraryItem, 'id'>): void {
  requireText(item.tripId, 'Trip ID')
  requireText(item.placeId, 'Place ID')
  requireDate(item.date, 'Itinerary item date')

  if (!Number.isInteger(item.order) || item.order < 0) {
    throw new ValidationError('Itinerary item order must be a non-negative integer.')
  }

  if (item.arrivalTime !== undefined &&
      (typeof item.arrivalTime !== 'string' ||
       !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.arrivalTime))) {
    throw new ValidationError('Arrival time must use the HH:mm format.')
  }

  if (item.durationMinutes !== undefined &&
      (!Number.isInteger(item.durationMinutes) || item.durationMinutes <= 0)) {
    throw new ValidationError('Duration must be a positive number of minutes.')
  }

  if (item.travelDurationMinutes !== undefined &&
      (!Number.isInteger(item.travelDurationMinutes) || item.travelDurationMinutes < 0)) {
    throw new ValidationError('Travel duration must be a non-negative number of minutes.')
  }

  if (item.transport !== undefined && typeof item.transport !== 'string') {
    throw new ValidationError('Transport must be text.')
  }
  if (item.travelDistanceMeters !== undefined &&
      (!Number.isSafeInteger(item.travelDistanceMeters) || item.travelDistanceMeters < 0)) {
    throw new ValidationError('Travel distance must be a non-negative integer number of meters.')
  }
  if (item.note !== undefined && typeof item.note !== 'string') {
    throw new ValidationError('Itinerary item note must be text.')
  }
}
