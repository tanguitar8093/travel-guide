import { database, type TravelDatabase } from './database'
import { EntityNotFoundError, ValidationError } from './errors'
import type { RouteMap, RouteMapPlace, NewRouteMap, NewRouteMapPlace, RouteMapChanges, RouteMapPlaceChanges } from './models'
import { validateRouteMap, validateRouteMapPlace } from './validation'
import { assertRouteEndpointReference, clearRouteEndpointReferences } from './route-endpoint'

export class RouteMapRepository {
  private readonly storage: TravelDatabase

  constructor(storage: TravelDatabase = database) {
    this.storage = storage
  }

  async create(input: NewRouteMap): Promise<string> {
    validateRouteMap(input)
    const id = crypto.randomUUID()
    await this.storage.transaction('rw', this.referenceTables(), async () => {
      await this.assertTrip(input, id)
      await this.assertEndpoints(input, id)
      await this.storage.routeMaps.add({ ...input, id })
    })
    return id
  }

  async update(id: string, changes: RouteMapChanges): Promise<void> {
    await this.storage.transaction('rw', this.referenceTables(), async () => {
      const current = await this.storage.routeMaps.get(id)
      if (!current) throw new EntityNotFoundError('Route map', id)
      const next = { ...current, ...changes }
      validateRouteMap(next)
      await this.assertTrip(next, id)
      await this.assertEndpoints(next, id)
      await this.storage.routeMaps.put(next)
    })
  }

  async delete(id: string): Promise<void> {
    await this.storage.transaction('rw', this.storage.routeMaps, this.storage.routeMapPlaces, async () => {
      if (!await this.getById(id)) throw new EntityNotFoundError('Route map', id)
      await this.storage.routeMapPlaces.where('routeMapId').equals(id).delete()
      await this.storage.routeMaps.delete(id)
    })
  }

  getById(id: string): Promise<RouteMap | undefined> { return this.storage.routeMaps.get(id) }
  list(): Promise<RouteMap[]> { return this.storage.routeMaps.toArray() }
  findByTripId(tripId: string): Promise<RouteMap | undefined> {
    return this.storage.routeMaps.where('tripId').equals(tripId).first()
  }

  private async assertTrip(map: NewRouteMap, id: string) {
    if (!map.tripId) return
    if (!await this.storage.trips.get(map.tripId)) throw new EntityNotFoundError('Trip', map.tripId)
    const existing = await this.findByTripId(map.tripId)
    if (existing && existing.id !== id) throw new ValidationError('This trip already has a route map.')
  }

  private referenceTables() {
    return this.storage.tables.filter(table =>
      ['routeMaps', 'trips', 'places', 'routeMapPlaces', 'sharedItineraries'].includes(table.name))
  }

  private async assertEndpoints(map: NewRouteMap, id: string): Promise<void> {
    for (const endpoint of [map.origin, map.destination]) {
      if (endpoint) await assertRouteEndpointReference(this.storage, id, endpoint)
    }
  }
}

export class RouteMapPlaceRepository {
  private readonly storage: TravelDatabase

  constructor(storage: TravelDatabase = database) {
    this.storage = storage
  }

  async create(input: NewRouteMapPlace): Promise<string> {
    validateRouteMapPlace(input)
    const id = crypto.randomUUID()
    await this.storage.transaction('rw', this.storage.routeMaps, this.storage.routeMapPlaces, async () => {
      await this.assertMap(input, id)
      await this.storage.routeMapPlaces.add({ ...input, id })
    })
    return id
  }

  async update(id: string, changes: RouteMapPlaceChanges): Promise<void> {
    await this.storage.transaction('rw', this.storage.routeMaps, this.storage.routeMapPlaces, async () => {
      const current = await this.getById(id)
      if (!current) throw new EntityNotFoundError('Route map place', id)
      const next = { ...current, ...changes }
      validateRouteMapPlace(next)
      await this.assertMap(next, id)
      if (current.routeMapId !== next.routeMapId) {
        await clearRouteEndpointReferences(this.storage, endpoint =>
          endpoint.kind === 'route-map-place' && endpoint.routeMapPlaceId === id)
      }
      await this.storage.routeMapPlaces.put(next)
    })
  }

  async delete(id: string): Promise<void> {
    await this.storage.transaction('rw', this.storage.routeMapPlaces, this.storage.routeMaps, async () => {
      if (!await this.getById(id)) throw new EntityNotFoundError('Route map place', id)
      await clearRouteEndpointReferences(this.storage, endpoint =>
        endpoint.kind === 'route-map-place' && endpoint.routeMapPlaceId === id)
      await this.storage.routeMapPlaces.delete(id)
    })
  }

  getById(id: string): Promise<RouteMapPlace | undefined> { return this.storage.routeMapPlaces.get(id) }
  list(): Promise<RouteMapPlace[]> { return this.storage.routeMapPlaces.toArray() }
  findByRouteMapId(id: string): Promise<RouteMapPlace[]> {
    return this.storage.routeMapPlaces.where('routeMapId').equals(id).toArray()
  }

  private async assertMap(place: NewRouteMapPlace, id: string) {
    if (!await this.storage.routeMaps.get(place.routeMapId)) throw new EntityNotFoundError('Route map', place.routeMapId)
    const identities: [string, string][] = []
    if (place.googlePlaceId !== undefined) identities.push(['[routeMapId+googlePlaceId]', place.googlePlaceId])
    if (place.location?.source === 'osm') {
      identities.push(['[routeMapId+location.reference.id]', place.location.reference.id])
    }
    for (const [index, reference] of identities) {
      const existing = await this.storage.routeMapPlaces.where(index).equals([place.routeMapId, reference]).first()
      if (existing && existing.id !== id) throw new ValidationError('This location is already on the route map.')
    }
  }
}

export const routeMaps = new RouteMapRepository()
export const routeMapPlaces = new RouteMapPlaceRepository()
