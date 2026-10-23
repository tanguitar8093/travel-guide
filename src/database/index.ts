export {
  EntityInUseError,
  EntityNotFoundError,
  ValidationError,
} from './errors'
export { BackupRepository, backupRepository as indexedBackupRepository } from './backup.repository'
export type { BackupCounts, TravelBackup } from './backup.repository'
export { LabelRepository, labels as indexedLabels } from './label.repository'
export {
  SupabaseRegionRepository,
  supabaseRegions,
} from './supabase.region.repository'
export {
  supabaseBackupRepository,
  supabaseItineraryItems,
  supabaseLabels,
  supabasePlaces,
  supabaseTrips,
} from './supabase.repositories'
export {
  itineraryItems as indexedItineraryItems,
  places as indexedPlaces,
  regions as indexedRegions,
  trips as indexedTrips,
} from './repositories'
export {
  getDatabaseMode,
  getDatabaseModeLabel,
  getSyncMode,
  getSyncModeLabel,
  setDatabaseMode,
  setSyncMode,
  type DatabaseMode,
  type SyncMode,
  subscribeDatabaseMode,
  subscribeSyncMode,
} from './runtime'
export { useDatabaseMode } from './useDatabaseMode'
export { useSyncMode } from './useSyncMode'
export type {
  ItineraryItem,
  ItineraryItemChanges,
  Label,
  LabelChanges,
  NewItineraryItem,
  NewLabel,
  NewPlace,
  NewRegion,
  NewTrip,
  Place,
  PlaceChanges,
  PlaceIcon,
  Region,
  RegionChanges,
  Trip,
  TripChanges,
} from './models'
export { placeIcons } from './models'
export { TripCollaborationRepository, tripCollaborationEnabled } from './trip-collaboration.repository'
export { SharedTripRepository, sharedTrips } from './shared-trip.repository'
export type { SharedTripDocument, SharedTripSnapshot } from './shared-trip.types'
export type {
  CollaborationDetails, CollaborationList, CollaborationTrip, SharedTripItem,
  SharedTripPlace, TripAccess, TripInvitation, TripMember, TripMemberRole,
} from './trip-collaboration.types'
export type { RouteMap, RouteMapPlace, NewRouteMap, NewRouteMapPlace, RouteMapChanges, RouteMapPlaceChanges } from './models'
export { RouteMapRepository, RouteMapPlaceRepository } from './route-map.repository'
export { getRouteMapEndpoint } from './route-endpoint'
export type { RouteEndpointSelection } from '../geo/contracts'

import { routeMaps as indexedRouteMaps, routeMapPlaces as indexedRouteMapPlaces } from './route-map.repository'
import { supabaseRouteMaps, supabaseRouteMapPlaces } from './supabase.route-map.repository'
import { backupRepository as indexedBackupRepository } from './backup.repository'
import type { BackupCounts, TravelBackup } from './backup.repository'
import { labels as indexedLabels } from './label.repository'
import { itineraryItems as indexedItineraryItems, places as indexedPlaces, regions as indexedRegions, trips as indexedTrips } from './repositories'
import { getDatabaseMode, type DatabaseMode } from './runtime'
import { hybridBackend } from './hybrid.backend'
import { requireHybridStore, runHybridTask } from './hybrid.runtime'
import { DEFAULT_OSM_REGION, DEFAULT_OSM_REGION_ID, accountOsmRegionId } from '../geo/osm-coverage'
import { getMapProvider } from '../geo/provider-preference'
import { database } from './database'
import {
  supabaseBackupRepository,
  supabaseItineraryItems,
  supabaseLabels,
  supabasePlaces,
  supabaseTrips,
} from './supabase.repositories'
import { supabaseRegions } from './supabase.region.repository'
import type {
  ItineraryItem,
  Label,
  Place,
  Region,
  Trip,
} from './models'

type RegionRepositoryLike = {
  create(input: Parameters<typeof indexedRegions.create>[0]): Promise<string>
  update(id: string, changes: Parameters<typeof indexedRegions.update>[1]): Promise<void>
  delete(id: string): Promise<void>
  getById(id: string): Promise<Region | undefined>
  list(): Promise<Region[]>
}

type PlaceRepositoryLike = {
  create(input: Parameters<typeof indexedPlaces.create>[0]): Promise<string>
  update(id: string, changes: Parameters<typeof indexedPlaces.update>[1]): Promise<void>
  delete(id: string): Promise<void>
  getById(id: string): Promise<Place | undefined>
  list(): Promise<Place[]>
  findByRegionId(regionId: string): Promise<Place[]>
  findByLabelIds(labelIds: string[]): Promise<Place[]>
  addLabel(placeId: string, labelId: string): Promise<void>
  removeLabel(placeId: string, labelId: string): Promise<void>
}

type LabelRepositoryLike = {
  list(): Promise<Label[]>
  getById(id: string): Promise<Label | undefined>
  getDescendantIds(id: string): Promise<string[]>
  create(input: Parameters<typeof indexedLabels.create>[0]): Promise<string>
  update(id: string, changes: Parameters<typeof indexedLabels.update>[1]): Promise<void>
  delete(id: string): Promise<void>
}

type TripRepositoryLike = {
  create(input: Parameters<typeof indexedTrips.create>[0]): Promise<string>
  update(id: string, changes: Parameters<typeof indexedTrips.update>[1]): Promise<void>
  delete(id: string): Promise<void>
  getById(id: string): Promise<Trip | undefined>
  list(): Promise<Trip[]>
}

type ItineraryItemRepositoryLike = {
  create(input: Parameters<typeof indexedItineraryItems.create>[0]): Promise<string>
  update(id: string, changes: Parameters<typeof indexedItineraryItems.update>[1]): Promise<void>
  delete(id: string): Promise<void>
  getById(id: string): Promise<ItineraryItem | undefined>
  findByTripId(tripId: string): Promise<ItineraryItem[]>
  findByTripAndDate(tripId: string, date: string): Promise<ItineraryItem[]>
  reorderForDate(tripId: string, date: string, orderedIds: string[]): Promise<void>
}

type BackupRepositoryLike = {
  exportAll(): Promise<TravelBackup>
  validateImport(value: unknown): TravelBackup
  replaceAll(value: unknown): Promise<BackupCounts>
  clearAllData(): Promise<BackupCounts | void>
}

type DatabaseBackend = {
  regions: RegionRepositoryLike
  places: PlaceRepositoryLike
  labels: LabelRepositoryLike
  trips: TripRepositoryLike
  itineraryItems: ItineraryItemRepositoryLike
  backupRepository: BackupRepositoryLike
  routeMaps: Pick<typeof indexedRouteMaps, 'create' | 'update' | 'delete' | 'getById' | 'list' | 'findByTripId'>
  routeMapPlaces: Pick<typeof indexedRouteMapPlaces, 'create' | 'update' | 'delete' | 'getById' | 'list' | 'findByRouteMapId'>
}

const indexedDbBackend: DatabaseBackend = {
  regions: indexedRegions,
  places: indexedPlaces,
  labels: indexedLabels,
  trips: indexedTrips,
  itineraryItems: indexedItineraryItems,
  backupRepository: indexedBackupRepository,
  routeMaps: indexedRouteMaps,
  routeMapPlaces: indexedRouteMapPlaces,
}

const supabaseBackend: DatabaseBackend = {
  regions: supabaseRegions,
  places: supabasePlaces,
  labels: supabaseLabels,
  trips: supabaseTrips,
  itineraryItems: supabaseItineraryItems,
  backupRepository: supabaseBackupRepository,
  routeMaps: supabaseRouteMaps,
  routeMapPlaces: supabaseRouteMapPlaces,
}

const databaseBackends: Record<DatabaseMode, DatabaseBackend> = {
  indexeddb: indexedDbBackend,
  supabase: supabaseBackend,
  hybrid: hybridBackend,
}

function activeBackend(): DatabaseBackend {
  return databaseBackends[getDatabaseMode()]
}

export async function prepareMapWorkspace(): Promise<void> {
  if (getMapProvider() !== 'osm') return
  const mode = getDatabaseMode()
  if (mode === 'hybrid') {
    const store = requireHybridStore()
    const id = await accountOsmRegionId(store.getWorkspaceOwnerId())
    if (await store.read(repositories => repositories.regions.getById(id))) return
    await runHybridTask(active => {
      if (active !== store) throw new Error('帳號已切換，未建立預設區域。')
      return active.mutateDatabase('regions.prepareOsm', async storage => {
        if (!await storage.regions.get(id)) await storage.regions.add({ ...DEFAULT_OSM_REGION, id })
      })
    })
  } else if (mode === 'supabase') {
    await supabaseRegions.prepareOsmRegion()
  } else {
    await database.transaction('rw', database.regions, async () => {
      if (!await database.regions.get(DEFAULT_OSM_REGION_ID)) {
        await database.regions.add({ ...DEFAULT_OSM_REGION, id: DEFAULT_OSM_REGION_ID })
      }
    })
  }
}

export const routeMaps: DatabaseBackend['routeMaps'] = {
  create: (input) => {
    return activeBackend().routeMaps.create(input)
  },
  update: (id, changes) => {
    return activeBackend().routeMaps.update(id, changes)
  },
  delete: (id) => activeBackend().routeMaps.delete(id),
  getById: (id) => activeBackend().routeMaps.getById(id),
  list: () => activeBackend().routeMaps.list(),
  findByTripId: (id) => activeBackend().routeMaps.findByTripId(id),
}

export const routeMapPlaces: DatabaseBackend['routeMapPlaces'] = {
  create: (input) => {
    return activeBackend().routeMapPlaces.create(input)
  },
  update: (id, changes) => {
    return activeBackend().routeMapPlaces.update(id, changes)
  },
  delete: (id) => activeBackend().routeMapPlaces.delete(id),
  getById: (id) => activeBackend().routeMapPlaces.getById(id),
  list: () => activeBackend().routeMapPlaces.list(),
  findByRouteMapId: (id) => activeBackend().routeMapPlaces.findByRouteMapId(id),
}

export const regions = {
  create(input: Parameters<typeof indexedRegions.create>[0]) {
    return activeBackend().regions.create(input)
  },
  update(id: string, changes: Parameters<typeof indexedRegions.update>[1]) {
    return activeBackend().regions.update(id, changes)
  },
  delete(id: string) {
    return activeBackend().regions.delete(id)
  },
  getById(id: string) {
    return activeBackend().regions.getById(id)
  },
  list() {
    return activeBackend().regions.list()
  },
}

export const places = {
  create(input: Parameters<typeof indexedPlaces.create>[0]) {
    return activeBackend().places.create(input)
  },
  update(id: string, changes: Parameters<typeof indexedPlaces.update>[1]) {
    return activeBackend().places.update(id, changes)
  },
  delete(id: string) {
    return activeBackend().places.delete(id)
  },
  getById(id: string) {
    return activeBackend().places.getById(id)
  },
  list() {
    return activeBackend().places.list()
  },
  findByRegionId(regionId: string) {
    return activeBackend().places.findByRegionId(regionId)
  },
  findByLabelIds(labelIds: string[]) {
    return activeBackend().places.findByLabelIds(labelIds)
  },
  addLabel(placeId: string, labelId: string) {
    return activeBackend().places.addLabel(placeId, labelId)
  },
  removeLabel(placeId: string, labelId: string) {
    return activeBackend().places.removeLabel(placeId, labelId)
  },
}

export const labels = {
  list() {
    return activeBackend().labels.list()
  },
  getById(id: string) {
    return activeBackend().labels.getById(id)
  },
  getDescendantIds(id: string) {
    return activeBackend().labels.getDescendantIds(id)
  },
  create(input: Parameters<typeof indexedLabels.create>[0]) {
    return activeBackend().labels.create(input)
  },
  update(id: string, changes: Parameters<typeof indexedLabels.update>[1]) {
    return activeBackend().labels.update(id, changes)
  },
  delete(id: string) {
    return activeBackend().labels.delete(id)
  },
  assignToPlace(placeId: string, labelId: string) {
    return activeBackend().places.addLabel(placeId, labelId)
  },
  removeFromPlace(placeId: string, labelId: string) {
    return activeBackend().places.removeLabel(placeId, labelId)
  },
  listPlaces() {
    return activeBackend().places.list()
  },
}

export const trips = {
  create(input: Parameters<typeof indexedTrips.create>[0]) {
    return activeBackend().trips.create(input)
  },
  update(id: string, changes: Parameters<typeof indexedTrips.update>[1]) {
    return activeBackend().trips.update(id, changes)
  },
  delete(id: string) {
    return activeBackend().trips.delete(id)
  },
  getById(id: string) {
    return activeBackend().trips.getById(id)
  },
  list() {
    return activeBackend().trips.list()
  },
}

export const itineraryItems = {
  create(input: Parameters<typeof indexedItineraryItems.create>[0]) {
    return activeBackend().itineraryItems.create(input)
  },
  update(id: string, changes: Parameters<typeof indexedItineraryItems.update>[1]) {
    return activeBackend().itineraryItems.update(id, changes)
  },
  delete(id: string) {
    return activeBackend().itineraryItems.delete(id)
  },
  getById(id: string) {
    return activeBackend().itineraryItems.getById(id)
  },
  findByTripId(tripId: string) {
    return activeBackend().itineraryItems.findByTripId(tripId)
  },
  findByTripAndDate(tripId: string, date: string) {
    return activeBackend().itineraryItems.findByTripAndDate(tripId, date)
  },
  reorderForDate(tripId: string, date: string, orderedIds: string[]) {
    return activeBackend().itineraryItems.reorderForDate(tripId, date, orderedIds)
  },
}

export const backupRepository = {
  exportAll() {
    return activeBackend().backupRepository.exportAll()
  },
  validateImport(value: unknown) {
    return activeBackend().backupRepository.validateImport(value)
  },
  replaceAll(value: unknown) {
    return activeBackend().backupRepository.replaceAll(value)
  },
  clearAllData() {
    return activeBackend().backupRepository.clearAllData()
  },
}
