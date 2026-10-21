import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PublicItineraryDatabase, SEED_KEY, seedDemoDatabase } from './database'
import { createDemoDataset } from './fixtures'

let db: PublicItineraryDatabase
beforeEach(() => { db = new PublicItineraryDatabase(`public-sharing-db-test-${crypto.randomUUID()}`) })
afterEach(async () => { await db.delete() })

describe('POC IndexedDB structure and seed', () => {
  it('persists source and independent snapshots across database reopen', async () => {
    const dataset = createDemoDataset()
    await seedDemoDatabase(db, dataset)
    const name = db.name
    db.close()
    db = new PublicItineraryDatabase(name)
    expect(await db.trips.toArray()).toEqual(dataset.trips)
    expect(await db.itineraryItems.count()).toBe(9)
    expect(await db.publicItineraries.get('demo-public-kyoto')).toEqual(dataset.publicItineraries[0])
  })

  it('initializes once, including concurrent calls, and does not resurrect deleted demo data', async () => {
    const results = await Promise.all([
      seedDemoDatabase(db, createDemoDataset()), seedDemoDatabase(db, createDemoDataset()),
    ])
    expect(results.sort()).toEqual([false, true])
    expect(await db.publicItineraries.count()).toBe(2)
    await db.trips.delete('demo-personal-kyoto')
    await db.publicItineraries.clear()
    expect(await seedDemoDatabase(db, createDemoDataset())).toBe(false)
    expect(await db.trips.count()).toBe(0)
    expect(await db.publicItineraries.count()).toBe(0)
  })

  it('enforces source uniqueness and permits republishing after deletion', async () => {
    await seedDemoDatabase(db, createDemoDataset())
    const row = (await db.publicItineraries.get('demo-public-kyoto'))!
    await expect(db.publicItineraries.add({ ...row, id: 'duplicate' })).rejects.toMatchObject({ name: 'ConstraintError' })
    expect(await db.publicItineraries.count()).toBe(2)
    await db.publicItineraries.delete(row.id)
    await db.publicItineraries.add({ ...row, id: 'republished' })
    expect((await db.publicItineraries.where('sourceTripId').equals(row.sourceTripId).first())?.id).toBe('republished')
  })

  it('rolls back every table and seed marker on a late write failure, then allows retry', async () => {
    const dataset = createDemoDataset()
    dataset.publicItineraries.push({ ...dataset.publicItineraries[0], id: 'duplicate-source' })
    await expect(seedDemoDatabase(db, dataset)).rejects.toThrow()
    for (const table of db.tables) expect(await table.count()).toBe(0)
    expect(await seedDemoDatabase(db, createDemoDataset())).toBe(true)
    expect(await db.metadata.get(SEED_KEY)).toEqual({ key: SEED_KEY, version: 1 })
  })

  it('keeps public snapshots available when source entities are deleted', async () => {
    await seedDemoDatabase(db, createDemoDataset())
    const row = await db.publicItineraries.get('demo-public-kyoto')
    await db.transaction('rw', [db.trips, db.regions, db.places, db.itineraryItems], async () => {
      await db.trips.clear()
      await db.regions.clear()
      await db.places.clear()
      await db.itineraryItems.clear()
    })
    expect(await db.publicItineraries.get('demo-public-kyoto')).toEqual(row)
  })

  it('provides coherent fixtures without private fields or source IDs in public snapshots', () => {
    const dataset = createDemoDataset()
    const sourceIds = new Set([
      ...dataset.trips, ...dataset.regions, ...dataset.places, ...dataset.items,
    ].map(row => row.id))
    for (const row of dataset.publicItineraries) {
      const { trip, region, places, items } = row.snapshot
      expect(trip.regionId).toBe(region.id)
      expect(items).toHaveLength(places.length)
      for (const entity of [trip, region, ...places, ...items]) expect(sourceIds.has(entity.id)).toBe(false)
      for (const place of places) {
        expect(place.regionIds).toEqual([region.id])
        expect(place).not.toHaveProperty('notes')
        expect(place).not.toHaveProperty('labelIds')
      }
      for (const item of items) {
        expect(item.tripId).toBe(trip.id)
        expect(places.some(place => place.id === item.placeId)).toBe(true)
        expect(item.note).toBeTruthy()
      }
    }
    dataset.places[0].name = 'modified'
    expect(createDemoDataset().places[0].name).toBe('清水寺')
  })
})
