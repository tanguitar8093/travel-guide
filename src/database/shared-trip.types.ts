import type { Region } from './models'
import type { CollaborationTrip, SharedTripItem, SharedTripPlace } from './trip-collaboration.types'

export interface SharedTripDocument {
  trip: CollaborationTrip
  region: Region
  places: SharedTripPlace[]
  items: SharedTripItem[]
}

export interface SharedTripSnapshot {
  id: string
  version: string
  document: SharedTripDocument | null
}

export interface SharedTripTask {
  tripId: string
  baseVersion: string
  before: SharedTripDocument
  after: SharedTripDocument
  predecessorOperationId?: string
  conflict?: SharedTripSnapshot
}

export type SharedTripSaveResult =
  | { status: 'applied'; operationId: string; snapshot: SharedTripSnapshot }
  | { status: 'conflict'; snapshot: SharedTripSnapshot }

// Released in every build. Individual trips still require explicit activation.
export const sharedTripEditingEnabled = true
