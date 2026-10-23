import { clonePublicSnapshot } from './core'
import type { PublicItineraryCatalog } from './shared-catalog'
import { createSharedCatalogCore } from './shared-catalog'
import { createCatalogCloud } from './catalog-cloud'
import { capturePublicCatalogAccount } from './catalog-runtime'
import type { PublicSnapshot, Trip } from './models'

export function createCloudWorkspaceCore(catalog: PublicItineraryCatalog, ownerId: string) {
  const assertCurrent = capturePublicCatalogAccount(ownerId)
  const cloud = createCatalogCloud(ownerId)
  const core = createSharedCatalogCore(catalog, ownerId, { id: '',
    async read() { throw new Error('雲端發布需要來源快照。') },
    async write() { throw new Error('雲端套用必須使用不可分割的遠端程序呼叫（RPC）。') },
  }, assertCurrent, true, async sourceId => clonePublicSnapshot(await cloud.call('source', { sourceTripId: sourceId }) as PublicSnapshot))
  return {
    ...core,
    async apply(id: string): Promise<Trip> {
      const key = `apply:${ownerId}:${id}`
      const existing = await catalog.syncMetadata.get(key)
      const operationId = existing?.value ?? crypto.randomUUID()
      await catalog.syncMetadata.put({ key, value: operationId })
      const trip = await cloud.call('apply', { id, operationId }) as Trip
      if (!trip || typeof trip.id !== 'string' || typeof trip.name !== 'string') throw new Error('雲端套用結果未確認，請重試。')
      assertCurrent()
      await catalog.syncMetadata.delete(key)
      return trip
    },
  }
}
