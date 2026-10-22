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
import { ValidationError } from './errors'
import { hasGeoFormatFields } from './geo-format'
import { hybridBackend } from './hybrid.backend'
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

// Keep new-format writes isolated until backup and cloud/sync formats are ready.
function assertReleasedLocationWrite(input: object): void {
  if (!hasGeoFormatFields(input)) return
  if (getDatabaseMode() === 'indexeddb') return
  throw new ValidationError('OSM 位置資料目前只開放單機模式寫入；雲端與混合模式的備份/同步格式整合尚未完成。')
}

export const routeMaps: DatabaseBackend['routeMaps'] = {
  create: (input) => {
    assertReleasedLocationWrite(input)
    return activeBackend().routeMaps.create(input)
  },
  update: (id, changes) => {
    assertReleasedLocationWrite(changes)
    return activeBackend().routeMaps.update(id, changes)
  },
  delete: (id) => activeBackend().routeMaps.delete(id),
  getById: (id) => activeBackend().routeMaps.getById(id),
  list: () => activeBackend().routeMaps.list(),
  findByTripId: (id) => activeBackend().routeMaps.findByTripId(id),
}

export const routeMapPlaces: DatabaseBackend['routeMapPlaces'] = {
  create: (input) => {
    assertReleasedLocationWrite(input)
    return activeBackend().routeMapPlaces.create(input)
  },
  update: (id, changes) => {
    assertReleasedLocationWrite(changes)
    return activeBackend().routeMapPlaces.update(id, changes)
  },
  delete: (id) => activeBackend().routeMapPlaces.delete(id),
  getById: (id) => activeBackend().routeMapPlaces.getById(id),
  list: () => activeBackend().routeMapPlaces.list(),
  findByRouteMapId: (id) => activeBackend().routeMapPlaces.findByRouteMapId(id),
}

export const regions = {
  create(input: Parameters<typeof indexedRegions.create>[0]) {
    assertReleasedLocationWrite(input)
    return activeBackend().regions.create(input)
  },
  update(id: string, changes: Parameters<typeof indexedRegions.update>[1]) {
    assertReleasedLocationWrite(changes)
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
    assertReleasedLocationWrite(input)
    return activeBackend().places.create(input)
  },
  update(id: string, changes: Parameters<typeof indexedPlaces.update>[1]) {
    assertReleasedLocationWrite(changes)
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
    const backup = indexedBackupRepository.validateImport(value)
    if (backup.version === 3) {
      throw new ValidationError('新位置備份尚未開放正式匯入；需先完成雲端同步與正式 UI 整合。')
    }
    return activeBackend().backupRepository.replaceAll(value)
  },
  clearAllData() {
    return activeBackend().backupRepository.clearAllData()
  },
}
