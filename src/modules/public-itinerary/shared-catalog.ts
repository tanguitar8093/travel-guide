import Dexie, { type Table } from 'dexie'
import type { PublicItinerary, PublicItineraryCore, PublicSnapshot } from './models'
import { SharingError } from './models'
import type { PublicItineraryStorage } from './core'
import { applySnapshot, snapshotSource } from './core'
import { queueCatalogTask } from './catalog-sync'
import type { CatalogRecord, CatalogTask } from './catalog-sync'

export interface SharedPublicItinerary extends PublicItinerary {
  ownerId: string
  sourceWorkspaceId: string
}
export class PublicItineraryCatalog extends Dexie {
  publicItineraries!: Table<SharedPublicItinerary, string>
  syncTasks!: Table<CatalogTask, string>
  baselines!: Table<CatalogRecord, string>
  syncMetadata!: Table<{ key: string; value: string }, string>
  migrations!: Table<{ workspaceId: string }, string>
  constructor(name = 'travel-planner-public-catalog') {
    super(name)
    this.version(1).stores({
      publicItineraries: '&id, &[ownerId+sourceWorkspaceId+sourceTripId], ownerId, createdAt',
      migrations: '&workspaceId',
    })
    this.version(2).stores({
      syncTasks: '&operationId, ownerId, id, createdAt',
      baselines: '&id', syncMetadata: '&key',
    })
  }
}
export interface SharingWorkspace {
  id: string
  read<Result>(work: (db: PublicItineraryStorage) => Promise<Result>): Promise<Result>
  write<Result>(work: (db: PublicItineraryStorage) => Promise<Result>): Promise<Result>
}

// Public records live in a browser-wide catalog; personal graphs stay in the recipient's workspace.
export function createSharedCatalogCore(catalog: PublicItineraryCatalog, ownerId: string,
  workspace: SharingWorkspace, assertCurrent: () => void = () => {}, syncEnabled = false, loadSource?: (id: string) => Promise<PublicSnapshot>): PublicItineraryCore {
  async function requirePublic(id: string) {
    const row = await catalog.publicItineraries.get(id)
    if (!row) throw new SharingError('PUBLIC_NOT_FOUND')
    return row
  }
  function requireOwner(row: SharedPublicItinerary, sourceId: string) {
    assertCurrent()
    if (!ownerId || row.ownerId !== ownerId) throw new SharingError('FORBIDDEN')
    if (row.sourceTripId !== sourceId) throw new SharingError('SOURCE_MISMATCH')
  }
  return {
    async list(query = {}) {
      const term = query.search?.trim().toLocaleLowerCase() ?? ''
      return (await catalog.publicItineraries.toArray()).filter(({ snapshot }) =>
        (!query.regionName || snapshot.region.name === query.regionName)
        && (!term || snapshot.trip.name.toLocaleLowerCase().includes(term) || snapshot.region.name.toLocaleLowerCase().includes(term)),
      ).sort((a,b) => a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    },
    async readSnapshot(id) { return structuredClone((await requirePublic(id)).snapshot) },
    async findBySource(id) {
      assertCurrent()
      return catalog.publicItineraries.where('ownerId').equals(ownerId).filter(row => row.sourceTripId === id).first()
    },
    async publish(sourceId) {
      assertCurrent()
      if (!ownerId) throw new SharingError('FORBIDDEN')
      const snapshot = await (loadSource ? loadSource(sourceId) : workspace.read(db => snapshotSource(db, sourceId)))
      return catalog.transaction('rw', catalog.publicItineraries, catalog.syncTasks, catalog.baselines, async () => {
        assertCurrent()
        if (await catalog.publicItineraries.where('ownerId').equals(ownerId).filter(row => row.sourceTripId === sourceId).first()) {
          throw new SharingError('ALREADY_PUBLISHED')
        }
        const row: SharedPublicItinerary = { id: crypto.randomUUID(), ownerId, sourceWorkspaceId: workspace.id,
          sourceTripId: sourceId, createdAt: new Date().toISOString(), updatedAt: null, snapshot }
        assertCurrent()
        await catalog.publicItineraries.add(row)
        if (syncEnabled) await queueCatalogTask(catalog, row, 'publish')
        return structuredClone(row)
      })
    },
    async update(id, sourceId) {
      const before = await requirePublic(id)
      requireOwner(before, sourceId)
      if (!syncEnabled && before.sourceWorkspaceId && before.sourceWorkspaceId !== workspace.id) throw new SharingError('SOURCE_MISMATCH')
      const snapshot = await (loadSource ? loadSource(sourceId) : workspace.read(db => snapshotSource(db, sourceId)))
      return catalog.transaction('rw', catalog.publicItineraries, catalog.syncTasks, catalog.baselines, async () => {
        const row = await requirePublic(id)
        requireOwner(row, sourceId)
        const updated = { ...row, snapshot, updatedAt: new Date().toISOString() }
        await catalog.publicItineraries.put(updated)
        if (syncEnabled) await queueCatalogTask(catalog, updated, 'update')
        return structuredClone(updated)
      })
    },
    async withdraw(id, sourceId) {
      return catalog.transaction('rw', catalog.publicItineraries, catalog.syncTasks, catalog.baselines, async () => {
        const row = await requirePublic(id)
        requireOwner(row, sourceId)
        if (syncEnabled) await queueCatalogTask(catalog, row, 'withdraw')
        await catalog.publicItineraries.delete(id)
      })
    },
    async apply(id) {
      assertCurrent()
      if (!ownerId) throw new SharingError('FORBIDDEN')
      return workspace.write(async db => db.transaction('rw',
        [db.regions, db.places, db.labels, db.trips, db.itineraryItems], async () => {
          // Cross-database read only. Keep the recipient transaction alive until the catalog lookup finishes.
          const row = await Dexie.waitFor(requirePublic(id))
          assertCurrent()
          const trip = await applySnapshot(db, row.snapshot)
          assertCurrent()
          return trip
        }))
    },
  }
}

// One-time import: preserve previous publications and never resurrect an explicitly withdrawn record.
export async function migrateLegacyPublications(catalog: PublicItineraryCatalog,
  workspaceId: string, ownerId: string, rows: PublicItinerary[]) {
  return catalog.transaction('rw', catalog.publicItineraries, catalog.migrations, async () => {
    if (await catalog.migrations.get(workspaceId)) return
    for (const row of rows) {
      if (!await catalog.publicItineraries.get(row.id)) {
        const duplicate = await catalog.publicItineraries.where('[ownerId+sourceWorkspaceId+sourceTripId]')
          .equals([ownerId, workspaceId, row.sourceTripId]).first()
        if (!duplicate) await catalog.publicItineraries.add({ ...row, ownerId, sourceWorkspaceId: workspaceId })
      }
    }
    await catalog.migrations.add({ workspaceId })
  })
}
