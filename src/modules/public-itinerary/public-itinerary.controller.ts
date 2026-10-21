import Dexie, { liveQuery } from 'dexie'
import { database } from '../../database/database'
import { getDatabaseMode } from '../../database/runtime'
import { requireHybridStore, runHybridTask } from '../../database/hybrid.runtime'
import { createSharedCatalogCore, migrateLegacyPublications, PublicItineraryCatalog } from './shared-catalog'
import type { SharingWorkspace } from './shared-catalog'
import type { PublicItinerary, PublicItineraryCore } from './models'

const catalog = new PublicItineraryCatalog()
export function publicSharingAvailable() { return getDatabaseMode() !== 'supabase' }

async function migrateExistingCatalog() {
  const names = await Dexie.getDatabaseNames()
  for (const name of names.filter(name => name === database.name || name.startsWith('travel-planner-hybrid:'))) {
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
    if (mode === 'supabase') throw new Error('請切換至本機工作區套用或發佈行程。')
    if (mode === 'indexeddb') {
      const workspace: SharingWorkspace = { id: database.name,
        read: work => database.transaction('r', database.tables, () => work(database)),
        write: work => work(database) }
      return createSharedCatalogCore(catalog, userId, workspace)
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
    return createSharedCatalogCore(catalog, userId, workspace, assertCurrent)
  }
  // Catalog browsing never depends on the current account's private workspace.
  const browsing = createSharedCatalogCore(catalog, '', { id: '',
    read: async () => { throw new Error('No personal workspace') }, write: async () => { throw new Error('No personal workspace') } })
  async function prepared() { await migrateExistingCatalog() }
  return {
    async list(query) { await prepared(); return browsing.list(query) },
    async readSnapshot(id) { await prepared(); return browsing.readSnapshot(id) },
    async findBySource(id) { await prepared(); return currentCore().findBySource(id) },
    async publish(id) { await prepared(); return currentCore().publish(id) },
    async update(id, sourceId) { await prepared(); return currentCore().update(id, sourceId) },
    async withdraw(id, sourceId) { await prepared(); return currentCore().withdraw(id, sourceId) },
    async apply(id) { await prepared(); return currentCore().apply(id) },
    subscribe(next, error) {
      let active = true
      let unsubscribe = () => {}
      void prepared().then(() => {
        if (!active) return
        const subscription = liveQuery(() => browsing.list()).subscribe({ next, error })
        unsubscribe = () => subscription.unsubscribe()
      }).catch(error)
      return () => { active = false; unsubscribe() }
    },
  }
}
