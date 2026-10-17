import type { ItineraryItem, Label, Place, Region, Trip } from './models'

export interface SyncAccount {
  projectId: string
  userId: string
}

export interface SyncEntities {
  regions: Region
  places: Place
  labels: Label
  trips: Trip
  itineraryItems: ItineraryItem
}

export type SyncEntityName = keyof SyncEntities
export type SyncRecord = SyncEntities[SyncEntityName]
export type LocalSyncStatus = 'not-initialized' | 'local-only' | 'pending' | 'failed' | 'conflict'

export interface SyncChange {
  entity: SyncEntityName
  id: string
  kind: 'put' | 'delete'
  before?: SyncRecord
  after?: SyncRecord
  baseVersion?: string | null
  predecessorOperationId?: string
}

export interface SyncTask {
  sequence?: number
  operationId: string
  account: SyncAccount
  deviceId: string
  protocolVersion: 1
  operation: string
  createdAt: string
  changes: SyncChange[]
  status: 'pending' | 'failed' | 'conflict'
  attempts: number
  error?: string
  uploadChanges?: SyncChange[]
  conflictRecords?: Array<{ entity: SyncEntityName; id: string; version: string | null; record: SyncRecord | null }>
}

export interface SyncConflictReview {
  id: 'workspace'
  token: string
  createdAt: string
  localFingerprint: string
  cloudFingerprint: string
  cursor: string
  pendingOperations: number
  rows: Array<{ entity: SyncEntityName; id: string; local: SyncRecord | null; cloud: SyncRecord | null }>
  cloudRecords: Array<{ entity: SyncEntityName; id: string; version: string; record: SyncRecord | null }>
  localChoiceChanges: SyncChange[]
}

export interface SyncMetadata {
  id: 'workspace'
  account: SyncAccount
  deviceId: string
  initialized: boolean
  cursor?: string
  lastSyncedAt?: string
}

export interface SyncBaseline {
  entity: SyncEntityName
  id: string
  version: string | null
  record?: SyncRecord
  sequence?: string
}

export interface LocalSyncSummary {
  initialized: boolean
  status: LocalSyncStatus
  pendingCount: number
  failedCount: number
  conflictCount: number
  lastSyncedAt?: string
}
