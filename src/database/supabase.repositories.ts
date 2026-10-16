import { supabase } from './supabase.client'
import { EntityInUseError, EntityNotFoundError, ValidationError } from './errors'
import type { BackupCounts } from './backup.repository'
import { backupRepository as indexedBackupRepository } from './backup.repository'
import type {
  ItineraryItem,
  ItineraryItemChanges,
  Label,
  LabelChanges,
  NewItineraryItem,
  NewLabel,
  NewPlace,
  NewTrip,
  Place,
  PlaceChanges,
  Trip,
  TripChanges,
} from './models'
import { validateItineraryItem, validateLabel, validatePlace, validateTrip } from './validation'
import { mapSupabasePermissionError, requireAuthenticatedUserId, withSupabaseTimeout, type SupabaseErrorLike } from './supabase.utils'
import { SupabaseRegionRepository } from './supabase.region.repository'

interface SupabaseLabelRow {
  id: string
  name: string
  color: string
  parent_id: string | null
}

interface SupabasePlaceRow {
  id: string
  name: string
  icon: string | null
  maps_url: string | null
  google_place_id: string | null
  notes: string | null
  place_regions?: Array<{ region_id: string }> | null
  place_labels?: Array<{ label_id: string }> | null
}

interface SupabaseTripRow {
  id: string
  region_id: string
  name: string
  start_date: string
  end_date: string
  owner_uid: string
  edit_mode: string
  editor_uids: string[]
}

interface SupabaseItineraryItemRow {
  id: string
  trip_id: string
  place_id: string
  date: string
  arrival_time: string | null
  duration_minutes: number | null
  transport: string | null
  travel_duration_minutes: number | null
  note: string | null
  sort_order: number
}

function mapSupabaseError(error: SupabaseErrorLike, fallback: string): Error {
  const permissionError = mapSupabasePermissionError(error)
  if (permissionError) {
    return permissionError
  }

  if (error.code === '23503') {
    return new EntityInUseError('Record', fallback, 'one or more related records still reference it.')
  }

  return new Error(error.message)
}

function normalizeLabel(row: SupabaseLabelRow): Label {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    ...(row.parent_id ? { parentId: row.parent_id } : {}),
  }
}

function toLabelInput(input: NewLabel) {
  return {
    name: input.name,
    color: input.color,
    parent_id: input.parentId ?? null,
  }
}

function normalizePlace(row: SupabasePlaceRow): Place {
  return {
    id: row.id,
    name: row.name,
    ...(row.icon ? { icon: row.icon as Place['icon'] } : {}),
    ...(row.maps_url ? { mapsUrl: row.maps_url } : {}),
    ...(row.google_place_id ? { googlePlaceId: row.google_place_id } : {}),
    ...(row.notes ? { notes: row.notes } : {}),
    regionIds: (row.place_regions ?? []).map((entry) => entry.region_id),
    labelIds: (row.place_labels ?? []).map((entry) => entry.label_id),
  }
}

function toPlaceInput(input: NewPlace) {
  return {
    name: input.name,
    icon: input.icon ?? null,
    maps_url: input.mapsUrl ?? null,
    google_place_id: input.googlePlaceId ?? null,
    notes: input.notes ?? null,
  }
}

function normalizeTrip(row: SupabaseTripRow): Trip {
  return {
    id: row.id,
    regionId: row.region_id,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
  }
}

function toTripInput(input: NewTrip, ownerUid: string) {
  return {
    region_id: input.regionId,
    name: input.name,
    start_date: input.startDate,
    end_date: input.endDate,
    owner_uid: ownerUid,
    edit_mode: 'private',
    editor_uids: [] as string[],
  }
}

function normalizeItineraryItem(row: SupabaseItineraryItemRow): ItineraryItem {
  return {
    id: row.id,
    tripId: row.trip_id,
    placeId: row.place_id,
    date: row.date,
    ...(row.arrival_time ? { arrivalTime: row.arrival_time } : {}),
    ...(row.duration_minutes !== null ? { durationMinutes: row.duration_minutes } : {}),
    ...(row.transport ? { transport: row.transport } : {}),
    ...(row.travel_duration_minutes !== null ? { travelDurationMinutes: row.travel_duration_minutes } : {}),
    ...(row.note ? { note: row.note } : {}),
    order: row.sort_order,
  }
}

function toItineraryInput(input: NewItineraryItem) {
  return {
    trip_id: input.tripId,
    place_id: input.placeId,
    date: input.date,
    arrival_time: input.arrivalTime ?? null,
    duration_minutes: input.durationMinutes ?? null,
    transport: input.transport ?? null,
    travel_duration_minutes: input.travelDurationMinutes ?? null,
    note: input.note ?? null,
    sort_order: input.order,
  }
}

function toItineraryUpdate(changes: ItineraryItemChanges) {
  return {
    ...(changes.tripId !== undefined ? { trip_id: changes.tripId } : {}),
    ...(changes.placeId !== undefined ? { place_id: changes.placeId } : {}),
    ...(changes.date !== undefined ? { date: changes.date } : {}),
    ...(changes.arrivalTime !== undefined ? { arrival_time: changes.arrivalTime } : {}),
    ...(changes.durationMinutes !== undefined ? { duration_minutes: changes.durationMinutes } : {}),
    ...(changes.transport !== undefined ? { transport: changes.transport } : {}),
    ...(changes.travelDurationMinutes !== undefined ? { travel_duration_minutes: changes.travelDurationMinutes } : {}),
    ...(changes.note !== undefined ? { note: changes.note } : {}),
    ...(changes.order !== undefined ? { sort_order: changes.order } : {}),
  }
}

async function assertRegionExists(regionId: string): Promise<void> {
  const { data, error } = await withSupabaseTimeout(
    Promise.resolve(supabase.from('regions').select('id').eq('id', regionId).maybeSingle()),
    'load region',
  )
  if (error) throw mapSupabaseError(error, regionId)
  if (!data) throw new EntityNotFoundError('Region', regionId)
}

async function assertLabelExists(labelId: string): Promise<void> {
  const { data, error } = await withSupabaseTimeout(
    Promise.resolve(supabase.from('labels').select('id').eq('id', labelId).maybeSingle()),
    'load label',
  )
  if (error) throw mapSupabaseError(error, labelId)
  if (!data) throw new EntityNotFoundError('Label', labelId)
}

async function loadLabelRows(): Promise<Label[]> {
  const { data, error } = await withSupabaseTimeout(
    Promise.resolve(
      supabase
        .from('labels')
        .select('id,name,color,parent_id')
        .order('name', { ascending: true }),
    ),
    'list labels',
  )
  if (error) throw mapSupabaseError(error, 'list labels')
  return (data ?? []).map((row) => normalizeLabel(row as SupabaseLabelRow))
}

async function loadPlaceRowsByIds(ids: string[]): Promise<Place[]> {
  if (!ids.length) return []

  const { data, error } = await withSupabaseTimeout(
    Promise.resolve(
      supabase
        .from('places')
        .select('id,name,icon,maps_url,google_place_id,notes,place_regions!place_regions_place_id_fkey(region_id),place_labels!place_labels_place_id_fkey(label_id)')
        .in('id', ids),
    ),
    'list places',
  )
  if (error) throw mapSupabaseError(error, 'list places')
  return (data ?? []).map((row) => normalizePlace(row as SupabasePlaceRow)).sort((left, right) => left.name.localeCompare(right.name))
}

async function loadPlaceRows(): Promise<Place[]> {
  const { data, error } = await withSupabaseTimeout(
    Promise.resolve(
      supabase
        .from('places')
        .select('id,name,icon,maps_url,google_place_id,notes,place_regions!place_regions_place_id_fkey(region_id),place_labels!place_labels_place_id_fkey(label_id)')
        .order('name', { ascending: true }),
    ),
    'list places',
  )
  if (error) throw mapSupabaseError(error, 'list places')
  return (data ?? []).map((row) => normalizePlace(row as SupabasePlaceRow))
}

async function loadTripRows(): Promise<Trip[]> {
  const { data, error } = await withSupabaseTimeout(
    Promise.resolve(
      supabase
        .from('trips')
        .select('id,region_id,name,start_date,end_date')
        .order('start_date', { ascending: true }),
    ),
    'list trips',
  )
  if (error) throw mapSupabaseError(error, 'list trips')
  return (data ?? []).map((row) => normalizeTrip(row as SupabaseTripRow))
}

async function loadItineraryRows(): Promise<ItineraryItem[]> {
  const { data, error } = await withSupabaseTimeout(
    Promise.resolve(
      supabase
        .from('itinerary_items')
        .select('id,trip_id,place_id,date,arrival_time,duration_minutes,transport,travel_duration_minutes,note,sort_order')
        .order('trip_id', { ascending: true })
        .order('date', { ascending: true })
        .order('sort_order', { ascending: true }),
    ),
    'list itinerary items',
  )
  if (error) throw mapSupabaseError(error, 'list itinerary items')
  return (data ?? []).map((row) => normalizeItineraryItem(row as SupabaseItineraryItemRow))
}

async function listLabelsForPlace(placeId: string): Promise<string[]> {
  const { data, error } = await withSupabaseTimeout(
    Promise.resolve(
      supabase.from('place_labels').select('label_id').eq('place_id', placeId),
    ),
    'load place labels',
  )
  if (error) throw mapSupabaseError(error, placeId)
  return [...new Set((data ?? []).map((row) => (row as { label_id: string }).label_id))]
}

async function syncPlaceRelations(placeId: string, regionIds: string[], labelIds: string[]): Promise<void> {
  const regionRows = regionIds.map((regionId) => ({ place_id: placeId, region_id: regionId }))
  const labelRows = labelIds.map((labelId) => ({ place_id: placeId, label_id: labelId }))

  const regionDelete = await withSupabaseTimeout(
    Promise.resolve(supabase.from('place_regions').delete().eq('place_id', placeId)),
    'clear place regions',
  )
  if (regionDelete.error) throw mapSupabaseError(regionDelete.error, placeId)

  const labelDelete = await withSupabaseTimeout(
    Promise.resolve(supabase.from('place_labels').delete().eq('place_id', placeId)),
    'clear place labels',
  )
  if (labelDelete.error) throw mapSupabaseError(labelDelete.error, placeId)

  if (regionRows.length) {
    const regionInsert = await withSupabaseTimeout(
      Promise.resolve(supabase.from('place_regions').insert(regionRows)),
      'insert place regions',
    )
    if (regionInsert.error) throw mapSupabaseError(regionInsert.error, placeId)
  }

  if (labelRows.length) {
    const labelInsert = await withSupabaseTimeout(
      Promise.resolve(supabase.from('place_labels').insert(labelRows)),
      'insert place labels',
    )
    if (labelInsert.error) throw mapSupabaseError(labelInsert.error, placeId)
  }
}

async function collectStaleItineraryItemIds(placeId: string): Promise<string[]> {
  const { data, error } = await withSupabaseTimeout(
    Promise.resolve(
      supabase.from('itinerary_items').select('id,trip_id,date,sort_order').eq('place_id', placeId),
    ),
    'load itinerary items',
  )
  if (error) throw mapSupabaseError(error, placeId)

  const scheduledItems = (data ?? []) as Array<{ id: string; trip_id: string; date: string; sort_order: number }>
  const staleEstimateIds = new Set<string>()

  for (const item of scheduledItems) {
    const { data: dayItems, error: dayError } = await withSupabaseTimeout(
      Promise.resolve(
        supabase
          .from('itinerary_items')
          .select('id,trip_id,place_id,date,arrival_time,duration_minutes,transport,travel_duration_minutes,note,sort_order')
          .eq('trip_id', item.trip_id)
          .eq('date', item.date)
          .order('sort_order', { ascending: true }),
      ),
      'load itinerary day',
    )
    if (dayError) throw mapSupabaseError(dayError, placeId)
    const items = (dayItems ?? []).map((row) => normalizeItineraryItem(row as SupabaseItineraryItemRow))
    const index = items.findIndex((candidate) => candidate.id === item.id)
    const nextItem = index >= 0 ? items[index + 1] : undefined
    if (nextItem) {
      staleEstimateIds.add(nextItem.id)
    }
    staleEstimateIds.add(item.id)
  }

  return [...staleEstimateIds]
}

async function assertTripExists(tripId: string): Promise<Trip> {
  const { data, error } = await withSupabaseTimeout(
    Promise.resolve(
      supabase
        .from('trips')
        .select('id,region_id,name,start_date,end_date')
        .eq('id', tripId)
        .maybeSingle(),
    ),
    'load trip',
  )
  if (error) throw mapSupabaseError(error, tripId)
  if (!data) throw new EntityNotFoundError('Trip', tripId)
  return normalizeTrip(data as SupabaseTripRow)
}

async function assertPlaceExistsById(placeId: string): Promise<Place> {
  const { data, error } = await withSupabaseTimeout(
    Promise.resolve(
      supabase
        .from('places')
        .select('id,name,icon,maps_url,google_place_id,notes,place_regions!place_regions_place_id_fkey(region_id),place_labels!place_labels_place_id_fkey(label_id)')
        .eq('id', placeId)
        .maybeSingle(),
    ),
    'load place',
  )
  if (error) throw mapSupabaseError(error, placeId)
  if (!data) throw new EntityNotFoundError('Place', placeId)
  return normalizePlace(data as SupabasePlaceRow)
}

export class SupabaseLabelRepository {
  list(): Promise<Label[]> {
    return loadLabelRows()
  }

  async listTree(): Promise<Label[]> {
    return loadLabelRows()
  }

  async getById(id: string): Promise<Label | undefined> {
    const { data, error } = await withSupabaseTimeout(
      Promise.resolve(
        supabase.from('labels').select('id,name,color,parent_id').eq('id', id).maybeSingle(),
      ),
      'get label',
    )
    if (error) throw mapSupabaseError(error, id)
    return data ? normalizeLabel(data as SupabaseLabelRow) : undefined
  }

  async getDescendantIds(id: string): Promise<string[]> {
    const records = await loadLabelRows()
    const descendants: string[] = []
    const visited = new Set([id])
    let parentIds = [id]

    while (parentIds.length > 0) {
      const children = records.filter(
        (label) => label.parentId !== undefined && parentIds.includes(label.parentId),
      )
      const next = children.filter((label) => !visited.has(label.id))

      for (const child of next) {
        descendants.push(child.id)
        visited.add(child.id)
      }

      parentIds = next.map((label) => label.id)
    }

    return descendants
  }

  async create(input: NewLabel): Promise<string> {
    validateLabel(input)
    if (input.parentId) {
      await assertLabelExists(input.parentId)
    }

    const labelId = crypto.randomUUID()

    const { data, error } = await withSupabaseTimeout(
      Promise.resolve(
        supabase
          .from('labels')
          .insert({ id: labelId, ...toLabelInput(input) })
          .select('id')
          .single(),
      ),
      'create label',
    )
    if (error) throw mapSupabaseError(error, 'new label')
    return (data as { id: string }).id
  }

  async update(id: string, changes: LabelChanges): Promise<void> {
    const current = await this.getById(id)
    if (!current) {
      throw new EntityNotFoundError('Label', id)
    }

    const next = { ...current, ...changes }
    validateLabel(next)
    if (next.parentId) {
      await assertLabelExists(next.parentId)
    }

    const records = await loadLabelRows()
    const visited = new Set<string>()
    let currentParent = next.parentId
    while (currentParent !== undefined) {
      if (currentParent === id || visited.has(currentParent)) {
        throw new ValidationError('Label hierarchy must not contain a cycle.')
      }

      visited.add(currentParent)
      currentParent = records.find((label) => label.id === currentParent)?.parentId
    }

    const { error } = await withSupabaseTimeout(
      Promise.resolve(
        supabase.from('labels').update(toLabelInput(next)).eq('id', id),
      ),
      'update label',
    )
    if (error) throw mapSupabaseError(error, id)
  }

  async delete(id: string): Promise<void> {
    const current = await this.getById(id)
    if (!current) {
      throw new EntityNotFoundError('Label', id)
    }

    const [{ count: childCount, error: childError }, { count: placeCount, error: placeError }] = await Promise.all([
      withSupabaseTimeout(
        Promise.resolve(
          supabase.from('labels').select('id', { count: 'exact', head: true }).eq('parent_id', id),
        ),
        'count child labels',
      ),
      withSupabaseTimeout(
        Promise.resolve(
          supabase.from('place_labels').select('label_id', { count: 'exact', head: true }).eq('label_id', id),
        ),
        'count place labels',
      ),
    ])

    if (childError) throw mapSupabaseError(childError, id)
    if (placeError) throw mapSupabaseError(placeError, id)
    if ((childCount ?? 0) > 0 || (placeCount ?? 0) > 0) {
      throw new EntityInUseError(
        'Label',
        id,
        'remove its child labels and place assignments before deleting it.',
      )
    }

    const { error } = await withSupabaseTimeout(
      Promise.resolve(supabase.from('labels').delete().eq('id', id)),
      'delete label',
    )
    if (error) throw mapSupabaseError(error, id)
  }

  async assignToPlace(placeId: string, labelId: string): Promise<void> {
    await assertPlaceExistsById(placeId)
    await assertLabelExists(labelId)

    const { data, error } = await withSupabaseTimeout(
      Promise.resolve(
        supabase.from('place_labels').select('place_id,label_id').eq('place_id', placeId).eq('label_id', labelId).maybeSingle(),
      ),
      'load place label assignment',
    )
    if (error) throw mapSupabaseError(error, labelId)
    if (data) return

    const insert = await withSupabaseTimeout(
      Promise.resolve(
        supabase.from('place_labels').insert({ place_id: placeId, label_id: labelId }),
      ),
      'assign label to place',
    )
    if (insert.error) throw mapSupabaseError(insert.error, labelId)
  }

  async removeFromPlace(placeId: string, labelId: string): Promise<void> {
    await assertPlaceExistsById(placeId)

    const { error } = await withSupabaseTimeout(
      Promise.resolve(
        supabase.from('place_labels').delete().eq('place_id', placeId).eq('label_id', labelId),
      ),
      'remove label from place',
    )
    if (error) throw mapSupabaseError(error, labelId)
  }

  listPlaces(): Promise<Place[]> {
    return loadPlaceRows()
  }
}

export class SupabasePlaceRepository {
  async create(input: NewPlace): Promise<string> {
    validatePlace(input)
    await Promise.all([
      ...input.regionIds.map((regionId) => assertRegionExists(regionId)),
      ...input.labelIds.map((labelId) => assertLabelExists(labelId)),
    ])

    const placeId = crypto.randomUUID()

    const { data, error } = await withSupabaseTimeout(
      Promise.resolve(
        supabase
          .from('places')
          .insert({ id: placeId, ...toPlaceInput(input) })
          .select('id')
          .single(),
      ),
      'create place',
    )
    if (error) throw mapSupabaseError(error, 'new place')

    const createdPlaceId = (data as { id: string }).id
    try {
      await syncPlaceRelations(createdPlaceId, input.regionIds, input.labelIds)
    } catch (cause) {
      await supabase.from('places').delete().eq('id', createdPlaceId)
      throw cause
    }

    return createdPlaceId
  }

  async update(id: string, changes: PlaceChanges): Promise<void> {
    const current = await this.getById(id)
    if (!current) {
      throw new EntityNotFoundError('Place', id)
    }

    const next = { ...current, ...changes }
    validatePlace(next)
    await Promise.all([
      ...next.regionIds.map((regionId) => assertRegionExists(regionId)),
      ...next.labelIds.map((labelId) => assertLabelExists(labelId)),
    ])

    const staleEstimateIds = current.googlePlaceId !== next.googlePlaceId
      ? await collectStaleItineraryItemIds(id)
      : []

    const { error } = await withSupabaseTimeout(
      Promise.resolve(
        supabase.from('places').update(toPlaceInput(next)).eq('id', id),
      ),
      'update place',
    )
    if (error) throw mapSupabaseError(error, id)

    await syncPlaceRelations(id, next.regionIds, next.labelIds)

    for (const itemId of staleEstimateIds) {
      const { error: itemError } = await withSupabaseTimeout(
        Promise.resolve(
          supabase.from('itinerary_items').update({ travel_duration_minutes: null }).eq('id', itemId),
        ),
        'clear itinerary estimate',
      )
      if (itemError) throw mapSupabaseError(itemError, itemId)
    }
  }

  async addLabel(id: string, labelId: string): Promise<void> {
    await assertPlaceExistsById(id)
    await assertLabelExists(labelId)

    const currentLabels = await listLabelsForPlace(id)
    if (currentLabels.includes(labelId)) {
      return
    }

    const { error } = await withSupabaseTimeout(
      Promise.resolve(supabase.from('place_labels').insert({ place_id: id, label_id: labelId })),
      'add place label',
    )
    if (error) throw mapSupabaseError(error, id)
  }

  async removeLabel(id: string, labelId: string): Promise<void> {
    await assertPlaceExistsById(id)

    const { error } = await withSupabaseTimeout(
      Promise.resolve(supabase.from('place_labels').delete().eq('place_id', id).eq('label_id', labelId)),
      'remove place label',
    )
    if (error) throw mapSupabaseError(error, id)
  }

  async delete(id: string): Promise<void> {
    const current = await this.getById(id)
    if (!current) {
      throw new EntityNotFoundError('Place', id)
    }

    const { count: itemCount, error: itemError } = await withSupabaseTimeout(
      Promise.resolve(
        supabase.from('itinerary_items').select('id', { count: 'exact', head: true }).eq('place_id', id),
      ),
      'count itinerary items',
    )
    if (itemError) throw mapSupabaseError(itemError, id)
    if ((itemCount ?? 0) > 0) {
      throw new EntityInUseError(
        'Place',
        id,
        'remove its itinerary items before deleting it.',
      )
    }

    const { error } = await withSupabaseTimeout(
      Promise.resolve(supabase.from('places').delete().eq('id', id)),
      'delete place',
    )
    if (error) throw mapSupabaseError(error, id)
  }

  async getById(id: string): Promise<Place | undefined> {
    const { data, error } = await withSupabaseTimeout(
      Promise.resolve(
        supabase
          .from('places')
          .select('id,name,icon,maps_url,google_place_id,notes,place_regions!place_regions_place_id_fkey(region_id),place_labels!place_labels_place_id_fkey(label_id)')
          .eq('id', id)
          .maybeSingle(),
      ),
      'get place',
    )
    if (error) throw mapSupabaseError(error, id)
    return data ? normalizePlace(data as SupabasePlaceRow) : undefined
  }

  list(): Promise<Place[]> {
    return loadPlaceRows()
  }

  async findByRegionId(regionId: string): Promise<Place[]> {
    const { data, error } = await withSupabaseTimeout(
      Promise.resolve(
        supabase.from('place_regions').select('place_id').eq('region_id', regionId),
      ),
      'load region places',
    )
    if (error) throw mapSupabaseError(error, regionId)
    return loadPlaceRowsByIds([...new Set((data ?? []).map((row) => (row as { place_id: string }).place_id))])
  }

  async findByLabelIds(labelIds: string[]): Promise<Place[]> {
    if (!labelIds.length) {
      return []
    }

    const { data, error } = await withSupabaseTimeout(
      Promise.resolve(
        supabase.from('place_labels').select('place_id').in('label_id', labelIds),
      ),
      'load label places',
    )
    if (error) throw mapSupabaseError(error, 'label places')
    return loadPlaceRowsByIds([...new Set((data ?? []).map((row) => (row as { place_id: string }).place_id))])
  }
}

export class SupabaseTripRepository {
  async create(input: NewTrip): Promise<string> {
    validateTrip(input)
    await assertRegionExists(input.regionId)
    const ownerUid = await requireAuthenticatedUserId()
    const tripId = crypto.randomUUID()

    const { data, error } = await withSupabaseTimeout(
      Promise.resolve(
        supabase
          .from('trips')
          .insert({ id: tripId, ...toTripInput(input, ownerUid) })
          .select('id')
          .single(),
      ),
      'create trip',
    )
    if (error) throw mapSupabaseError(error, 'new trip')
    return (data as { id: string }).id
  }

  async update(id: string, changes: TripChanges): Promise<void> {
    const current = await this.getById(id)
    if (!current) {
      throw new EntityNotFoundError('Trip', id)
    }

    const next = { ...current, ...changes }
    validateTrip(next)
    await assertRegionExists(next.regionId)

    const { data: itineraryRows, error: itineraryError } = await withSupabaseTimeout(
      Promise.resolve(
        supabase.from('itinerary_items').select('date').eq('trip_id', id),
      ),
      'check trip itinerary items',
    )
    if (itineraryError) throw mapSupabaseError(itineraryError, id)
    if ((itineraryRows ?? []).some((row) => {
      const date = (row as { date: string }).date
      return date < next.startDate || date > next.endDate
    })) {
      throw new ValidationError('Trip dates cannot exclude an existing itinerary item.')
    }

    const { error } = await withSupabaseTimeout(
      Promise.resolve(
        supabase
          .from('trips')
          .update({
            region_id: next.regionId,
            name: next.name,
            start_date: next.startDate,
            end_date: next.endDate,
          })
          .eq('id', id),
      ),
      'update trip',
    )
    if (error) throw mapSupabaseError(error, id)
  }

  async delete(id: string): Promise<void> {
    const current = await this.getById(id)
    if (!current) {
      throw new EntityNotFoundError('Trip', id)
    }

    const { error } = await withSupabaseTimeout(
      Promise.resolve(supabase.from('trips').delete().eq('id', id)),
      'delete trip',
    )
    if (error) throw mapSupabaseError(error, id)
  }

  async getById(id: string): Promise<Trip | undefined> {
    const { data, error } = await withSupabaseTimeout(
      Promise.resolve(
        supabase.from('trips').select('id,region_id,name,start_date,end_date').eq('id', id).maybeSingle(),
      ),
      'get trip',
    )
    if (error) throw mapSupabaseError(error, id)
    return data ? normalizeTrip(data as SupabaseTripRow) : undefined
  }

  async list(): Promise<Trip[]> {
    return loadTripRows()
  }
}

export class SupabaseItineraryItemRepository {
  async create(input: NewItineraryItem): Promise<string> {
    validateItineraryItem(input)
    const trip = await assertTripExists(input.tripId)
    await assertPlaceExistsById(input.placeId)

    if (input.date < trip.startDate || input.date > trip.endDate) {
      throw new ValidationError('Itinerary item date must be within the trip dates.')
    }

    const itineraryItemId = crypto.randomUUID()

    const { data, error } = await withSupabaseTimeout(
      Promise.resolve(
        supabase
          .from('itinerary_items')
          .insert({ id: itineraryItemId, ...toItineraryInput(input) })
          .select('id')
          .single(),
      ),
      'create itinerary item',
    )
    if (error) throw mapSupabaseError(error, 'new itinerary item')
    return (data as { id: string }).id
  }

  async update(id: string, changes: ItineraryItemChanges): Promise<void> {
    const current = await this.getById(id)
    if (!current) {
      throw new EntityNotFoundError('Itinerary item', id)
    }

    const routeChanged =
      (changes.placeId !== undefined && changes.placeId !== current.placeId) ||
      (Object.hasOwn(changes, 'transport') && changes.transport !== current.transport) ||
      (changes.date !== undefined && changes.date !== current.date) ||
      (changes.order !== undefined && changes.order !== current.order)

    const affectedDates = new Set([current.date])
    if (changes.date) affectedDates.add(changes.date)

    const beforeByDate = new Map<string, ItineraryItem[]>()
    if (routeChanged) {
      for (const date of affectedDates) {
        beforeByDate.set(date, await this.findByTripAndDate(current.tripId, date))
      }
    }

    const next = {
      ...current,
      ...changes,
      ...(routeChanged ? { travelDurationMinutes: undefined } : {}),
    }
    validateItineraryItem(next)
    const trip = await assertTripExists(next.tripId)
    await assertPlaceExistsById(next.placeId)
    if (next.date < trip.startDate || next.date > trip.endDate) {
      throw new ValidationError('Itinerary item date must be within the trip dates.')
    }

    const { error } = await withSupabaseTimeout(
      Promise.resolve(
        supabase
          .from('itinerary_items')
          .update(toItineraryUpdate(next))
          .eq('id', id),
      ),
      'update itinerary item',
    )
    if (error) throw mapSupabaseError(error, id)

    if (routeChanged) {
      for (const date of affectedDates) {
        const beforeItems = beforeByDate.get(date) ?? []
        const afterItems = await this.findByTripAndDate(current.tripId, date)
        const beforeIndex = beforeItems.findIndex((item) => item.id === id)
        const afterIndex = afterItems.findIndex((item) => item.id === id)
        const affectedIds = new Set<string>()
        if (beforeIndex >= 0 && beforeItems[beforeIndex + 1]) {
          affectedIds.add(beforeItems[beforeIndex + 1].id)
        }
        if (afterIndex >= 0 && afterItems[afterIndex + 1]) {
          affectedIds.add(afterItems[afterIndex + 1].id)
        }
        for (const affectedId of affectedIds) {
          const { error: affectedError } = await withSupabaseTimeout(
            Promise.resolve(
              supabase.from('itinerary_items').update({ travel_duration_minutes: null }).eq('id', affectedId),
            ),
            'clear itinerary travel duration',
          )
          if (affectedError) throw mapSupabaseError(affectedError, affectedId)
        }
      }
    }
  }

  async delete(id: string): Promise<void> {
    const current = await this.getById(id)
    if (!current) {
      throw new EntityNotFoundError('Itinerary item', id)
    }

    const dayItems = await this.findByTripAndDate(current.tripId, current.date)
    const index = dayItems.findIndex((item) => item.id === id)
    const successor = dayItems[index + 1]

    const { error } = await withSupabaseTimeout(
      Promise.resolve(supabase.from('itinerary_items').delete().eq('id', id)),
      'delete itinerary item',
    )
    if (error) throw mapSupabaseError(error, id)

    if (successor) {
      const { error: successorError } = await withSupabaseTimeout(
        Promise.resolve(
          supabase.from('itinerary_items').update({ travel_duration_minutes: null }).eq('id', successor.id),
        ),
        'clear successor travel duration',
      )
      if (successorError) throw mapSupabaseError(successorError, successor.id)
    }
  }

  async getById(id: string): Promise<ItineraryItem | undefined> {
    const { data, error } = await withSupabaseTimeout(
      Promise.resolve(
        supabase
          .from('itinerary_items')
          .select('id,trip_id,place_id,date,arrival_time,duration_minutes,transport,travel_duration_minutes,note,sort_order')
          .eq('id', id)
          .maybeSingle(),
      ),
      'get itinerary item',
    )
    if (error) throw mapSupabaseError(error, id)
    return data ? normalizeItineraryItem(data as SupabaseItineraryItemRow) : undefined
  }

  async findByTripId(tripId: string): Promise<ItineraryItem[]> {
    const { data, error } = await withSupabaseTimeout(
      Promise.resolve(
        supabase
          .from('itinerary_items')
          .select('id,trip_id,place_id,date,arrival_time,duration_minutes,transport,travel_duration_minutes,note,sort_order')
          .eq('trip_id', tripId)
          .order('date', { ascending: true })
          .order('sort_order', { ascending: true }),
      ),
      'list itinerary items by trip',
    )
    if (error) throw mapSupabaseError(error, tripId)
    return (data ?? []).map((row) => normalizeItineraryItem(row as SupabaseItineraryItemRow))
  }

  async findByTripAndDate(tripId: string, date: string): Promise<ItineraryItem[]> {
    const { data, error } = await withSupabaseTimeout(
      Promise.resolve(
        supabase
          .from('itinerary_items')
          .select('id,trip_id,place_id,date,arrival_time,duration_minutes,transport,travel_duration_minutes,note,sort_order')
          .eq('trip_id', tripId)
          .eq('date', date)
          .order('sort_order', { ascending: true }),
      ),
      'list itinerary items by day',
    )
    if (error) throw mapSupabaseError(error, tripId)
    return (data ?? []).map((row) => normalizeItineraryItem(row as SupabaseItineraryItemRow))
  }

  async reorderForDate(tripId: string, date: string, orderedIds: string[]): Promise<void> {
    const currentItems = await this.findByTripAndDate(tripId, date)
    const currentIds = new Set(currentItems.map((item) => item.id))
    const nextIds = new Set(orderedIds)
    if (
      orderedIds.length !== currentItems.length ||
      nextIds.size !== orderedIds.length ||
      orderedIds.some((id) => !currentIds.has(id))
    ) {
      throw new ValidationError('The reordered itinerary items do not match this trip day.')
    }

    const previousById = new Map<string, string | undefined>()
    const nextPreviousById = new Map<string, string | undefined>()
    for (let index = 0; index < currentItems.length; index += 1) {
      previousById.set(currentItems[index].id, currentItems[index - 1]?.placeId)
    }

    const nextItems = orderedIds.map((itemId) => {
      const item = currentItems.find((candidate) => candidate.id === itemId)
      if (!item) {
        throw new EntityNotFoundError('Itinerary item', itemId)
      }
      return item
    })
    for (let index = 0; index < nextItems.length; index += 1) {
      nextPreviousById.set(nextItems[index].id, nextItems[index - 1]?.placeId)
    }

    const maxCurrentOrder = currentItems.reduce((maximum, item) => Math.max(maximum, item.order), -1)
    const temporaryOrderStart = maxCurrentOrder + 1

    await Promise.all(
      orderedIds.map(async (itemId, order) => {
        const { error } = await withSupabaseTimeout(
          Promise.resolve(
            supabase
              .from('itinerary_items')
              .update({ sort_order: temporaryOrderStart + order })
              .eq('id', itemId),
          ),
          'reorder itinerary items (temporary order)',
        )
        if (error) throw mapSupabaseError(error, itemId)
      }),
    )

    await Promise.all(
      orderedIds.map(async (itemId, order) => {
        const updates = {
          sort_order: order,
          ...(previousById.get(itemId) !== nextPreviousById.get(itemId)
            ? { travel_duration_minutes: null }
            : {}),
        }
        const { error } = await withSupabaseTimeout(
          Promise.resolve(supabase.from('itinerary_items').update(updates).eq('id', itemId)),
          'reorder itinerary items (final order)',
        )
        if (error) throw mapSupabaseError(error, itemId)
      }),
    )
  }
}

export class SupabaseBackupRepository {
  private parsePreview(data: unknown): CloudBackupPreview {
    const preview = data as Partial<CloudBackupPreview> | null
    if (!preview?.token || !preview.current || !preview.incoming) {
      throw new ValidationError('無法取得雲端覆蓋預覽結果，請稍後再試。')
    }
    return {
      token: preview.token,
      current: preview.current,
      incoming: preview.incoming,
    }
  }

  private parseCounts(data: unknown): BackupCounts {
    const counts = data as Partial<BackupCounts> | null
    if (
      counts?.regions === undefined ||
      counts.places === undefined ||
      counts.labels === undefined ||
      counts.trips === undefined ||
      counts.itineraryItems === undefined
    ) {
      throw new ValidationError('雲端操作回傳格式不正確，請稍後再試。')
    }

    return {
      regions: counts.regions,
      places: counts.places,
      labels: counts.labels,
      trips: counts.trips,
      itineraryItems: counts.itineraryItems,
    }
  }

  validateImport(value: unknown) {
    return indexedBackupRepository.validateImport(value)
  }

  async exportAll() {
    const [regions, labels, places, trips, itineraryItems] = await Promise.all([
      supabaseRegions.list(),
      loadLabelRows(),
      loadPlaceRows(),
      loadTripRows(),
      loadItineraryRows(),
    ])

    return {
      format: 'travel-planner-backup' as const,
      version: 1 as const,
      exportedAt: new Date().toISOString(),
      data: { regions, places, labels, trips, itineraryItems },
    }
  }

  async previewReplaceAll(value: unknown): Promise<CloudBackupPreview> {
    const backup = this.validateImport(value)
    const { data, error } = await withSupabaseTimeout(
      Promise.resolve(
        supabase.rpc('app_backup_preview_replace', {
          p_backup: backup,
        }),
      ),
      'preview cloud replace',
    )
    if (error) throw mapSupabaseError(error, 'preview cloud replace')
    return this.parsePreview(data)
  }

  async replaceAll(value: unknown, previewToken?: string): Promise<BackupCounts> {
    if (!previewToken) {
      throw new ValidationError('雲端覆蓋需要先完成預覽並再次確認。')
    }

    const backup = this.validateImport(value)
    const { data, error } = await withSupabaseTimeout(
      Promise.resolve(
        supabase.rpc('app_backup_apply_replace', {
          p_backup: backup,
          p_token: previewToken,
        }),
      ),
      'apply cloud replace',
    )
    if (error) throw mapSupabaseError(error, 'apply cloud replace')
    return this.parseCounts(data)
  }

  async previewClearAllData(): Promise<CloudBackupPreview> {
    const { data, error } = await withSupabaseTimeout(
      Promise.resolve(supabase.rpc('app_backup_preview_clear')),
      'preview cloud clear',
    )
    if (error) throw mapSupabaseError(error, 'preview cloud clear')
    return this.parsePreview(data)
  }

  async clearAllData(previewToken?: string): Promise<BackupCounts> {
    if (!previewToken) {
      throw new ValidationError('雲端清空需要先完成預覽並再次確認。')
    }

    const { data, error } = await withSupabaseTimeout(
      Promise.resolve(
        supabase.rpc('app_backup_apply_clear', {
          p_token: previewToken,
        }),
      ),
      'apply cloud clear',
    )
    if (error) throw mapSupabaseError(error, 'apply cloud clear')
    return this.parseCounts(data)
  }
}

export interface CloudBackupPreview {
  token: string
  current: BackupCounts
  incoming: BackupCounts
}

export const supabaseRegions = new SupabaseRegionRepository()
export const supabaseLabels = new SupabaseLabelRepository()
export const supabasePlaces = new SupabasePlaceRepository()
export const supabaseTrips = new SupabaseTripRepository()
export const supabaseItineraryItems = new SupabaseItineraryItemRepository()
export const supabaseBackupRepository = new SupabaseBackupRepository()
