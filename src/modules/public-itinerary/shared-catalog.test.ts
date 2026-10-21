import 'fake-indexeddb/auto'
import { afterEach, expect, it } from 'vitest'
import { TravelDatabase } from '../../database/database'
import { SyncDatabase } from '../../database/sync.database'
import { SyncAccountContext } from '../../database/sync-account-context'
import { LocalSyncStore } from '../../database/local-sync.store'
import { createPublicItineraryCore } from './core'
import { createSharedCatalogCore, migrateLegacyPublications, PublicItineraryCatalog } from './shared-catalog'
import type { SharingWorkspace } from './shared-catalog'
import Dexie from 'dexie'
const opened: Dexie[] = []
afterEach(async () => { for (const db of opened.splice(0)) await db.delete() })
function workspace(db: TravelDatabase): SharingWorkspace {
  return { id: db.name, read: work => db.transaction('r', db.tables, () => work(db)), write: work => work(db) }
}
async function source(db: TravelDatabase) {
  await db.regions.add({ id: 'region', name: '京都', zoom: 12 })
  await db.places.add({ id: 'place', name: '清水寺', regionIds: ['region'], labelIds: [], notes: '私人備註' })
  await db.trips.add({ id: 'source', name: '京都行程', regionId: 'region', startDate: '2026-11-01', endDate: '2026-11-01' })
  await db.itineraryItems.add({ id: 'item', tripId: 'source', placeId: 'place', date: '2026-11-01', order: 0 })
}
it('shares list and preview between accounts, applies only to the recipient and restricts management to the owner', async () => {
  const catalog = new PublicItineraryCatalog(`catalog-${crypto.randomUUID()}`)
  const a = new TravelDatabase(`a-${crypto.randomUUID()}`), b = new TravelDatabase(`b-${crypto.randomUUID()}`)
  opened.push(catalog, a, b)
  await source(a)
  const owner = createSharedCatalogCore(catalog, 'a', workspace(a))
  const recipient = createSharedCatalogCore(catalog, 'b', workspace(b))
  const row = await owner.publish('source')
  expect(await recipient.list()).toEqual([row])
  expect(await recipient.readSnapshot(row.id)).toEqual(row.snapshot)
  expect(await recipient.findBySource('source')).toBeUndefined()
  await expect(recipient.update(row.id, 'source')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  await expect(recipient.withdraw(row.id, 'source')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  const trip = await recipient.apply(row.id)
  expect(await b.trips.get(trip.id)).toEqual(trip)
  expect(await a.trips.count()).toBe(1)
  const places = await b.places.toArray()
  expect(places[0]).not.toHaveProperty('notes')
  expect(await b.labels.get(places[0].labelIds[0])).toMatchObject({ name: '京都行程(分享)' })
  await a.trips.update('source', { name: '新版' })
  await owner.update(row.id, 'source')
  expect((await recipient.readSnapshot(row.id)).trip.name).toBe('新版')
  expect((await b.trips.get(trip.id))!.name).toBe('京都行程（副本）')
  await a.trips.delete('source')
  await owner.withdraw(row.id, 'source')
  expect(await recipient.list()).toEqual([])
  await expect(recipient.apply(row.id)).rejects.toMatchObject({ code: 'PUBLIC_NOT_FOUND' })
  expect(await b.trips.get(trip.id)).toEqual(trip)
})
it('imports previous account-local publications once without resurrecting withdrawn records', async () => {
  const catalog = new PublicItineraryCatalog(`catalog-${crypto.randomUUID()}`)
  const db = new TravelDatabase(`legacy-${crypto.randomUUID()}`)
  opened.push(catalog, db)
  await source(db)
  const old = await createPublicItineraryCore(db).publish('source')
  await Promise.all([migrateLegacyPublications(catalog, db.name, 'a', [old]), migrateLegacyPublications(catalog, db.name, 'a', [old])])
  const core = createSharedCatalogCore(catalog, 'a', workspace(db))
  expect(await core.list()).toHaveLength(1)
  expect(await core.findBySource('source')).toMatchObject({ id: old.id, ownerId: 'a' })
  await core.withdraw(old.id, 'source')
  await migrateLegacyPublications(catalog, db.name, 'a', [old])
  expect(await core.list()).toEqual([])
})
it('commits exactly one concurrent publication per owner and workspace', async () => {
  const catalog = new PublicItineraryCatalog(`catalog-${crypto.randomUUID()}`)
  const db = new TravelDatabase(`source-${crypto.randomUUID()}`)
  opened.push(catalog, db)
  await source(db)
  const core = createSharedCatalogCore(catalog, 'a', workspace(db))
  const results = await Promise.allSettled([core.publish('source'), core.publish('source')])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect(await catalog.publicItineraries.count()).toBe(1)
})
it('rolls back all recipient data if a late write fails', async () => {
  const catalog = new PublicItineraryCatalog(`catalog-${crypto.randomUUID()}`)
  const a = new TravelDatabase(`a-${crypto.randomUUID()}`), b = new TravelDatabase(`b-${crypto.randomUUID()}`)
  opened.push(catalog, a, b)
  await source(a)
  const row = await createSharedCatalogCore(catalog, 'a', workspace(a)).publish('source')
  const fail = () => { throw new Error('failed item') }
  b.itineraryItems.hook('creating', fail)
  try {
    await expect(createSharedCatalogCore(catalog, 'b', workspace(b)).apply(row.id)).rejects.toThrow('failed item')
    expect(await Promise.all(b.tables.map(table => table.count()))).toEqual(b.tables.map(() => 0))
    expect(await catalog.publicItineraries.get(row.id)).toEqual(row)
  } finally { b.itineraryItems.hook('creating').unsubscribe(fail) }
})
it('applies the shared catalog into an isolated tracked account workspace and rejects account switching', async () => {
  const catalog = new PublicItineraryCatalog(`catalog-${crypto.randomUUID()}`)
  const a = new TravelDatabase(`a-${crypto.randomUUID()}`)
  const b = new SyncDatabase({ projectId: crypto.randomUUID(), userId: 'b' })
  opened.push(catalog, a, b)
  await source(a)
  const context = new SyncAccountContext()
  context.activate(b.account)
  const store = new LocalSyncStore(b, context)
  await store.prepareLocal()
  const row = await createSharedCatalogCore(catalog, 'a', workspace(a)).publish('source')
  const core = createSharedCatalogCore(catalog, 'b', { id: b.name,
    read: work => store.readDatabase(work), write: work => store.mutateDatabase('apply', work) }, store.captureAccount())
  const copy = await core.apply(row.id)
  expect(await b.trips.get(copy.id)).toEqual(copy)
  expect((await store.listTasks())[0].changes).toHaveLength(5)
  expect(await b.publicItineraries.count()).toBe(0)
  context.deactivate()
  await expect(core.apply(row.id)).rejects.toThrow('account')
  expect(await core.list()).toHaveLength(1)
})
