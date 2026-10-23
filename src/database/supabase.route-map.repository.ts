import { supabase } from './supabase.client'
import { EntityNotFoundError, ValidationError } from './errors'
import type { NewRouteMap, NewRouteMapPlace, RouteMap, RouteMapChanges, RouteMapPlace, RouteMapPlaceChanges } from './models'
import { validateRouteMap, validateRouteMapPlace } from './validation'
import { mapSupabasePermissionError, requireAuthenticatedUserId, withSupabaseTimeout, type SupabaseErrorLike } from './supabase.utils'

interface MapRow {
  id: string
  name: string
  trip_id: string | null
  selected_date: string | null
  origin_google_place_id: string | null
  destination_google_place_id: string | null
  transport: string
  origin: RouteMap['origin'] | null
  destination: RouteMap['destination'] | null
}

interface PlaceRow {
  id: string
  route_map_id: string
  google_place_id: string | null
  location: RouteMapPlace['location'] | null
  name: string | null
}

function fail(error: SupabaseErrorLike): never {
  throw mapSupabasePermissionError(error) ?? new ValidationError(error.message)
}

function mapInput(input: NewRouteMap) {
  return {
    name: input.name, trip_id: input.tripId ?? null, selected_date: input.selectedDate ?? null,
    origin_google_place_id: input.originGooglePlaceId ?? null,
    destination_google_place_id: input.destinationGooglePlaceId ?? null, transport: input.transport,
    origin: input.origin ?? null, destination: input.destination ?? null,
  }
}

function normalizeMap(row: MapRow): RouteMap {
  return {
    id: row.id, name: row.name, transport: row.transport,
    ...(row.trip_id ? { tripId: row.trip_id } : {}),
    ...(row.selected_date ? { selectedDate: row.selected_date } : {}),
    ...(row.origin_google_place_id ? { originGooglePlaceId: row.origin_google_place_id } : {}),
    ...(row.destination_google_place_id ? { destinationGooglePlaceId: row.destination_google_place_id } : {}),
    ...(row.origin ? { origin: row.origin } : {}),
    ...(row.destination ? { destination: row.destination } : {}),
  }
}

function placeInput(input: NewRouteMapPlace) {
  return { route_map_id: input.routeMapId, google_place_id: input.googlePlaceId ?? null, location: input.location ?? null, name: input.name ?? null }
}

function normalizePlace(row: PlaceRow): RouteMapPlace {
  return {
    id: row.id, routeMapId: row.route_map_id,
    ...(row.google_place_id ? { googlePlaceId: row.google_place_id } : {}),
    ...(row.location ? { location: row.location } : {}),
    ...(row.name ? { name: row.name } : {}),
  }
}

const mapColumns = 'id,name,trip_id,selected_date,origin_google_place_id,destination_google_place_id,transport,origin,destination'
const placeColumns = 'id,route_map_id,google_place_id,name,location'

export class SupabaseRouteMapRepository {
  async create(input: NewRouteMap): Promise<string> {
    validateRouteMap(input)
    const owner = await requireAuthenticatedUserId()
    const { data, error } = await withSupabaseTimeout(Promise.resolve(
      supabase.from('route_maps').insert({ id: crypto.randomUUID(), ...mapInput(input), owner_uid: owner }).select('id').single(),
    ), 'create route map')
    if (error) fail(error)
    return (data as { id: string }).id
  }

  async update(id: string, changes: RouteMapChanges): Promise<void> {
    const current = await this.getById(id)
    if (!current) throw new EntityNotFoundError('Route map', id)
    const next = { ...current, ...changes }
    validateRouteMap(next)
    const { data, error } = await withSupabaseTimeout(Promise.resolve(
      supabase.from('route_maps').update(mapInput(next)).eq('id', id).select('id').maybeSingle(),
    ), 'update route map')
    if (error) fail(error)
    if (!data) throw new EntityNotFoundError('Route map', id)
  }

  async delete(id: string): Promise<void> {
    const { data, error } = await withSupabaseTimeout(Promise.resolve(
      supabase.from('route_maps').delete().eq('id', id).select('id').maybeSingle(),
    ), 'delete route map')
    if (error) fail(error)
    if (!data) throw new EntityNotFoundError('Route map', id)
  }

  async getById(id: string): Promise<RouteMap | undefined> {
    const { data, error } = await withSupabaseTimeout(Promise.resolve(
      supabase.from('route_maps').select(mapColumns).eq('id', id).maybeSingle(),
    ), 'get route map')
    if (error) fail(error)
    return data ? normalizeMap(data as MapRow) : undefined
  }

  async findByTripId(id: string): Promise<RouteMap | undefined> {
    const { data, error } = await withSupabaseTimeout(Promise.resolve(
      supabase.from('route_maps').select(mapColumns).eq('trip_id', id).maybeSingle(),
    ), 'get trip route map')
    if (error) fail(error)
    return data ? normalizeMap(data as MapRow) : undefined
  }

  async list(): Promise<RouteMap[]> {
    const { data, error } = await withSupabaseTimeout(Promise.resolve(
      supabase.from('route_maps').select(mapColumns).order('name'),
    ), 'list route maps')
    if (error) fail(error)
    return (data as MapRow[]).map(normalizeMap)
  }
}

export class SupabaseRouteMapPlaceRepository {
  async create(input: NewRouteMapPlace): Promise<string> {
    validateRouteMapPlace(input)
    // The database derives ownership from the parent, including admin-owned maps.
    const { data, error } = await withSupabaseTimeout(Promise.resolve(
      supabase.from('route_map_places').insert({ id: crypto.randomUUID(), ...placeInput(input) }).select('id').single(),
    ), 'create route map place')
    if (error) fail(error)
    return (data as { id: string }).id
  }

  async update(id: string, changes: RouteMapPlaceChanges): Promise<void> {
    const current = await this.getById(id)
    if (!current) throw new EntityNotFoundError('Route map place', id)
    const next = { ...current, ...changes }
    validateRouteMapPlace(next)
    const { data, error } = await withSupabaseTimeout(Promise.resolve(
      supabase.from('route_map_places').update(placeInput(next)).eq('id', id).select('id').maybeSingle(),
    ), 'update route map place')
    if (error) fail(error)
    if (!data) throw new EntityNotFoundError('Route map place', id)
  }

  async delete(id: string): Promise<void> {
    const { data, error } = await withSupabaseTimeout(Promise.resolve(
      supabase.from('route_map_places').delete().eq('id', id).select('id').maybeSingle(),
    ), 'delete route map place')
    if (error) fail(error)
    if (!data) throw new EntityNotFoundError('Route map place', id)
  }

  async getById(id: string): Promise<RouteMapPlace | undefined> {
    const { data, error } = await withSupabaseTimeout(Promise.resolve(
      supabase.from('route_map_places').select(placeColumns).eq('id', id).maybeSingle(),
    ), 'get route map place')
    if (error) fail(error)
    return data ? normalizePlace(data as PlaceRow) : undefined
  }

  async list(): Promise<RouteMapPlace[]> {
    const { data, error } = await withSupabaseTimeout(Promise.resolve(
      supabase.from('route_map_places').select(placeColumns),
    ), 'list route map places')
    if (error) fail(error)
    return (data as PlaceRow[]).map(normalizePlace)
  }

  async findByRouteMapId(id: string): Promise<RouteMapPlace[]> {
    const { data, error } = await withSupabaseTimeout(Promise.resolve(
      supabase.from('route_map_places').select(placeColumns).eq('route_map_id', id),
    ), 'list map places')
    if (error) fail(error)
    return (data as PlaceRow[]).map(normalizePlace)
  }
}

export const supabaseRouteMaps = new SupabaseRouteMapRepository()
export const supabaseRouteMapPlaces = new SupabaseRouteMapPlaceRepository()
