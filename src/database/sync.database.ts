import type { Table } from 'dexie'
import { TravelDatabase } from './database'
import { getSyncDatabaseName, validateSyncAccount } from './sync-account-context'
import type { SyncAccount, SyncBaseline, SyncConflictReview, SyncMetadata, SyncTask } from './sync.types'
import type { SharedTripSnapshot } from './shared-trip.types'

export class SyncDatabase extends TravelDatabase {
  readonly account: SyncAccount
  outbox!: Table<SyncTask, number>
  syncMetadata!: Table<SyncMetadata, string>
  syncBaselines!: Table<SyncBaseline, [string, string]>
  syncConflicts!: Table<SyncConflictReview, string>
  sharedItineraries!: Table<SharedTripSnapshot, string>

  constructor(account: SyncAccount) {
    super(getSyncDatabaseName(account))
    this.account = Object.freeze(validateSyncAccount(account))
    this.version(5).stores({
      regions: '&id, name',
      places: '&id, name, *regionIds, *labelIds, googlePlaceId',
      labels: '&id, name, parentId',
      trips: '&id, regionId, startDate, endDate',
      itineraryItems: '&id, tripId, placeId, date, [tripId+date+order]',
      outbox: '++sequence, &operationId, status',
      syncMetadata: '&id',
      syncBaselines: '[entity+id]',
    })
    this.version(6).stores({ syncConflicts: '&id' })
    this.version(8).stores({
      routeMaps: '&id, &tripId',
      routeMapPlaces: '&id, routeMapId, &[routeMapId+googlePlaceId]',
    })
    this.version(9).stores({ sharedItineraries: '&id' })
  }
}
