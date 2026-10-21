import Dexie, { liveQuery } from 'dexie'
import { database } from '../../database/database'
import { getDatabaseMode } from '../../database/runtime'
import { requireHybridStore, runHybridTask } from '../../database/hybrid.runtime'
import { createSharedCatalogCore, migrateLegacyPublications } from './shared-catalog'
import type { SharingWorkspace } from './shared-catalog'
import type { PublicItinerary, PublicItineraryCore } from './models'
import { createCloudWorkspaceCore } from './cloud-workspace'
import { capturePublicCatalogAccount, refreshPublicCatalog } from './catalog-runtime'

import { publicCatalog as catalog } from './catalog-instance'
export function publicSharingAvailable() { return true }

async function migrateExistingCatalog() {
  const names = await Dexie.getDatabaseNames()
  if (names.includes('travel-planner-public-catalog')) {
    const legacy = new Dexie('travel-planner-public-catalog')
    try {
      await legacy.open()
      const rows = await legacy.table<import('./shared-catalog').SharedPublicItinerary>('publicItineraries').toArray()
      for (const owner of new Set(rows.map(row => row.ownerId))) {
        await migrateLegacyPublications(catalog, `legacy-catalog:${owner}`, owner, rows.filter(row => row.ownerId === owner))
      }
    } finally { legacy.close() }
  }
  for (const name of names.filter(name => name === database.name || name.startsWith(`travel-planner-hybrid:${encodeURIComponent(new URL(import.meta.env.VITE_SUPABASE_URL!).origin)}:`))) {
    const old = new Dexie(name)
    try {
      await old.open()
      if (!old.tables.some(table => table.name === 'publicItineraries')) continue
      const ownerId = name.startsWith('travel-planner-hybrid:') ? decodeURIComponent(name.split(':').at(-1)!) : ''
      // Legacy standalone records have no provable owner; expose them read-only rather than assigning them to whoever logs in.
      await migrateLegacyPublications(catalog, name, ownerId, await old.table<PublicItinerary>('publicItineraries').toArray())
    } finally { old.close() }
  }
}

export function createPublicItineraryController(userId: string): PublicItineraryCore & {
  subscribe(next: (rows: PublicItinerary[]) => void, error: (cause: unknown) => void): () => void
} {
  function currentCore() {
    const mode = getDatabaseMode()
    if (mode === 'supabase') return createCloudWorkspaceCore(catalog, userId)
    if (mode === 'indexeddb') {
      const workspace: SharingWorkspace = { id: database.name,
        read: work => database.transaction('r', database.tables, () => work(database)),
        write: work => work(database) }
      return createSharedCatalogCore(catalog, userId, workspace, capturePublicCatalogAccount(userId), true)
    }
    const store = requireHybridStore()
    if (store.getWorkspaceOwnerId() !== userId) throw new Error('帳號已切換，請重新操作。')
    const assertCurrent = store.captureAccount()
    const workspace: SharingWorkspace = { id: store.getSyncLockName(),
      read: work => store.readDatabase(work),
      write: work => runHybridTask(active => {
        if (active !== store) throw new Error('帳號已切換，請重新操作。')
        return active.mutateDatabase('publicItineraries.apply', work)
      }) }
    return createSharedCatalogCore(catalog, userId, workspace, assertCurrent, true)
  }
  // Catalog browsing never depends on the current account's private workspace.
  const browsing = createSharedCatalogCore(catalog, '', { id: '',
    read: async () => { throw new Error('No personal workspace') }, write: async () => { throw new Error('No personal workspace') } })
  async function prepared() { await migrateExistingCatalog() }
  return {
    async list(query) { await prepared(); return browsing.list(query) },
    async readSnapshot(id) { await prepared(); return browsing.readSnapshot(id) },
    async findBySource(id) { await prepared(); return currentCore().findBySource(id) },
    async publish(id) { await prepared(); const row = await currentCore().publish(id); void refreshPublicCatalog(); return row },
    async update(id, sourceId) { await prepared(); const row = await currentCore().update(id, sourceId); void refreshPublicCatalog(); return row },
    async withdraw(id, sourceId) { await prepared(); await currentCore().withdraw(id, sourceId); void refreshPublicCatalog() },
    async apply(id) { await prepared(); return currentCore().apply(id) },
    subscribe(next, error) {
      let active = true
      const refresh = () => { void refreshPublicCatalog() }
      let unsubscribe = () => {}
      void prepared().then(() => {
        if (!active) return
        const subscription = liveQuery(() => browsing.list()).subscribe({ next, error })
        unsubscribe = () => subscription.unsubscribe()
        refresh()
      }).catch(error)
      return () => { active = false; unsubscribe() }
    },
  }
}
