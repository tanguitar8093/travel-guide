import type { Table } from 'dexie'
import { TravelDatabase } from './database'
import { getSyncDatabaseName, validateSyncAccount } from './sync-account-context'
import type { SyncAccount, SyncBaseline, SyncMetadata, SyncTask } from './sync.types'

export class SyncDatabase extends TravelDatabase {
  readonly account: SyncAccount
  outbox!: Table<SyncTask, number>
  syncMetadata!: Table<SyncMetadata, string>
  syncBaselines!: Table<SyncBaseline, [string, string]>

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
  }
}
