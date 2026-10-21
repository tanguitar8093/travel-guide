import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { TravelDatabase } from '../../src/database/database'
import { TripRepository } from '../../src/database/repositories'
import { createPublicItineraryCore } from './core'
import { PublicItineraryDatabase, seedDemoDatabase } from './database'
import { createDemoDataset } from './fixtures'

let db: PublicItineraryDatabase
let productionDb: TravelDatabase

beforeEach(async () => {
  db = new PublicItineraryDatabase(`sharing-delete-${crypto.randomUUID()}`)
  productionDb = new TravelDatabase(`production-delete-${crypto.randomUUID()}`)
  await seedDemoDatabase(db, createDemoDataset())
})
afterEach(async () => { await Promise.all([db.delete(), productionDb.delete()]) })

it.each(['source', 'copy'] as const)('existing trip deletion accepts a sharing %s and preserves its management data', async kind => {
  const core = createPublicItineraryCore(db)
  const publicId = 'demo-public-kyoto'
  const snapshot = await core.readSnapshot(publicId)
  const trip = kind === 'source' ? (await db.trips.get('demo-personal-kyoto'))! : await core.apply(publicId)
  const [regions, places, labels, items] = await Promise.all([
    db.regions.toArray(), db.places.toArray(), db.labels.toArray(),
    db.itineraryItems.where('tripId').equals(trip.id).toArray(),
  ])
  await productionDb.transaction('rw', productionDb.tables, async () => {
    await productionDb.regions.bulkAdd(regions)
    await productionDb.places.bulkAdd(places)
    await productionDb.labels.bulkAdd(labels)
    await productionDb.trips.add(trip)
    await productionDb.itineraryItems.bulkAdd(items)
    await productionDb.routeMaps.add({ id: 'route', tripId: trip.id, name: '行程路線', transport: 'WALKING' })
    await productionDb.routeMapPlaces.add({ id: 'marker', routeMapId: 'route', googlePlaceId: 'google-place' })
  })

  // Exercise the real repository with isolated data, including its route-map cascade.
  await new TripRepository(productionDb).delete(trip.id)
  expect(await productionDb.trips.get(trip.id)).toBeUndefined()
  expect(await productionDb.itineraryItems.count()).toBe(0)
  expect(await productionDb.routeMaps.count()).toBe(0)
  expect(await productionDb.routeMapPlaces.count()).toBe(0)
  expect(await productionDb.regions.toArray()).toEqual(regions)
  expect(await productionDb.places.toArray()).toEqual(places)
  expect(await productionDb.labels.toArray()).toEqual(labels)

  // Reflect the same existing deletion boundary in the POC stores.
  await db.transaction('rw', db.trips, db.itineraryItems, async () => {
    await db.itineraryItems.where('tripId').equals(trip.id).delete()
    await db.trips.delete(trip.id)
  })
  expect(await core.readSnapshot(publicId)).toEqual(snapshot)
  expect((await core.apply(publicId)).regionId).not.toBe(trip.regionId)
})
