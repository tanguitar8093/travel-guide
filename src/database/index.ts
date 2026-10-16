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
  setDatabaseMode,
  type DatabaseMode,
  subscribeDatabaseMode,
} from './runtime'
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

import { backupRepository as indexedBackupRepository } from './backup.repository'
import { labels as indexedLabels } from './label.repository'
import { itineraryItems as indexedItineraryItems, places as indexedPlaces, regions as indexedRegions, trips as indexedTrips } from './repositories'
import { getDatabaseMode } from './runtime'
import {
  supabaseBackupRepository,
  supabaseItineraryItems,
  supabaseLabels,
  supabasePlaces,
  supabaseTrips,
} from './supabase.repositories'
import { supabaseRegions } from './supabase.region.repository'

const indexedDbBackend = {
  regions: indexedRegions,
  places: indexedPlaces,
  labels: indexedLabels,
  trips: indexedTrips,
  itineraryItems: indexedItineraryItems,
  backupRepository: indexedBackupRepository,
}

const supabaseBackend = {
  regions: supabaseRegions,
  places: supabasePlaces,
  labels: supabaseLabels,
  trips: supabaseTrips,
  itineraryItems: supabaseItineraryItems,
  backupRepository: supabaseBackupRepository,
}

function activeBackend() {
  return getDatabaseMode() === 'supabase' ? supabaseBackend : indexedDbBackend
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
