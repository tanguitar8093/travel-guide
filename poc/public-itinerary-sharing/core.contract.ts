import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPublicItineraryCore } from './core'
import { PublicItineraryDatabase, seedDemoDatabase } from './database'
import { createDemoDataset } from './fixtures'
import type { PublicItineraryCore, PublicSnapshot } from './models'

let db: PublicItineraryDatabase
let core: PublicItineraryCore
const sourceId = 'demo-personal-kyoto'

beforeEach(async () => {
  db = new PublicItineraryDatabase(`public-sharing-contract-${crypto.randomUUID()}`)
  const dataset = createDemoDataset()
  dataset.publicItineraries = []
  // Repeated reference + unused place + membership in a second region.
  dataset.items.push({ ...dataset.items[0], id: 'repeat-item', date: '2026-11-07', order: 3 })
  dataset.places.push({ ...dataset.places[0], id: 'unused-place', name: '未使用的收藏' })
  dataset.regions.push({ id: 'other-region', name: '其他私人區域', zoom: 10 })
  dataset.places[0].regionIds.push('other-region')
  await seedDemoDatabase(db, dataset)
  core = createPublicItineraryCore(db)
})
afterEach(async () => { await db.delete() })

const allRows = async () => Promise.all(db.tables.map(table => table.toArray()))
const ids = (s: PublicSnapshot) => [s.trip, s.region, ...s.places, ...s.items].map(row => row.id)
const withoutIds = ({ id: _id, tripId: _tripId, placeId: _placeId, ...fields }: PublicSnapshot['items'][number]) => fields

async function assertClone(snapshot: PublicSnapshot) {
  const source = createDemoDataset()
  const originalIds = new Set([
    ...source.regions, ...source.trips, ...source.places, ...source.items, { id: 'repeat-item' },
  ].map(row => row.id))
  expect(snapshot.schemaVersion).toBe(1)
  expect(snapshot.trip).toMatchObject({
    name: source.trips[0].name, startDate: '2026-11-06', endDate: '2026-11-08', regionId: snapshot.region.id,
  })
  expect(snapshot.region).toMatchObject({ name: '日本・京都', zoom: 13 })
  expect(snapshot.places).toHaveLength(9)
  expect(snapshot.items).toHaveLength(10)
  expect(new Set(ids(snapshot)).size).toBe(ids(snapshot).length)
  for (const id of ids(snapshot)) expect(originalIds.has(id)).toBe(false)
  for (const place of snapshot.places) {
    expect(place).not.toHaveProperty('notes')
    expect(place).not.toHaveProperty('labelIds')
    expect(place.regionIds).toEqual([snapshot.region.id])
    expect(place.name).not.toBe('未使用的收藏')
    const original = source.places.find(row => row.name === place.name)!
    expect(place).toMatchObject({ name: original.name, icon: original.icon, mapsUrl: original.mapsUrl })
  }
  expect(snapshot).not.toHaveProperty('labels')
  const expectedItems = await db.itineraryItems.where('tripId').equals(sourceId).toArray()
  expect(snapshot.items.map(withoutIds)).toEqual(expect.arrayContaining(expectedItems.map(withoutIds)))
  for (const item of snapshot.items) {
    expect(item.tripId).toBe(snapshot.trip.id)
    expect(snapshot.places.some(place => place.id === item.placeId)).toBe(true)
  }
  const temple = snapshot.places.find(place => place.name === '清水寺')!
  expect(snapshot.items.filter(item => item.placeId === temple.id)).toHaveLength(2)
}

describe('publish and read contract', () => {
  it('publishes a complete sanitized independent graph and persists source lookup', async () => {
    const before = await db.trips.toArray()
    const row = await core.publish(sourceId)
    expect(row.sourceTripId).toBe(sourceId)
    expect(row.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/)
    expect(row.updatedAt).toBeNull()
    await assertClone(row.snapshot)
    expect(await core.findBySource(sourceId)).toEqual(row)
    expect(await core.readSnapshot(row.id)).toEqual(row.snapshot)
    expect(await db.trips.toArray()).toEqual(before)
    expect(await db.publicItineraries.get(row.id)).toEqual(row)
  })

  it('rejects duplicate publication without overwriting the existing row', async () => {
    const row = await core.publish(sourceId)
    await expect(core.publish(sourceId)).rejects.toMatchObject({ code: 'ALREADY_PUBLISHED' })
    expect(await db.publicItineraries.toArray()).toEqual([row])
  })

  it('concurrent publication commits exactly one public record', async () => {
    const results = await Promise.allSettled([core.publish(sourceId), core.publish(sourceId)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(await db.publicItineraries.count()).toBe(1)
  })

  it('rejects missing sources and broken references without writing a snapshot', async () => {
    await expect(core.publish('missing')).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' })
    await db.places.delete(createDemoDataset().places[0].id)
    await expect(core.publish(sourceId)).rejects.toMatchObject({ code: 'INVALID_SOURCE' })
    expect(await db.publicItineraries.count()).toBe(0)
  })

  it('rejects a missing region before committing', async () => {
    await db.regions.delete('demo-kyoto')
    await expect(core.publish(sourceId)).rejects.toMatchObject({ code: 'INVALID_SOURCE' })
    expect(await db.publicItineraries.count()).toBe(0)
  })

  it('source editing/deletion and mutation of returned data do not affect persisted snapshots', async () => {
    const row = await core.publish(sourceId)
    const saved = structuredClone(row.snapshot)
    const read = await core.readSnapshot(row.id)
    read.region.name = 'mutated result'
    row.snapshot.places[0].name = 'mutated publication result'
    await db.trips.update(sourceId, { name: '私人修改' })
    await db.places.clear()
    await db.regions.clear()
    await db.itineraryItems.clear()
    await db.trips.delete(sourceId)
    expect(await core.readSnapshot(row.id)).toEqual(saved)
    const applied = await core.apply(row.id)
    expect(applied.startDate).toBe(saved.trip.startDate)
  })

  it('lists by name or region, trims search, combines filters and returns empty lookup', async () => {
    const row = await core.publish(sourceId)
    await db.publicItineraries.add(createDemoDataset().publicItineraries[1])
    expect((await core.list()).map(item => item.id)).toEqual([row.id, 'demo-public-taipei'])
    expect(await core.list({ search: ' 京都 ' })).toEqual([row])
    expect(await core.list({ search: '寺院', regionName: '日本・京都' })).toEqual([row])
    expect(await core.list({ search: '京都', regionName: '台灣・台北' })).toEqual([])
    expect(await core.findBySource('missing')).toBeUndefined()
    await expect(core.readSnapshot('missing')).rejects.toMatchObject({ code: 'PUBLIC_NOT_FOUND' })
  })
})

describe('update, withdraw and republish contract', () => {
  it('fully replaces snapshot, preserves public identity/date and leaves applied copy intact', async () => {
    const row = await core.publish(sourceId)
    const copy = await core.apply(row.id)
    const savedCopy = await db.itineraryItems.where('tripId').equals(copy.id).toArray()
    await db.trips.update(sourceId, { name: '新版京都' })
    const removed = createDemoDataset().items[1]
    await db.itineraryItems.delete(removed.id)
    await db.itineraryItems.update(createDemoDataset().items[0].id, { arrivalTime: '10:15', note: '新版備註' })
    const updated = await core.update(row.id, sourceId)
    expect(updated).toMatchObject({ id: row.id, sourceTripId: sourceId, createdAt: row.createdAt })
    expect(updated.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/)
    expect(updated.snapshot.trip.name).toBe('新版京都')
    expect(updated.snapshot.items).toHaveLength(9)
    expect(updated.snapshot.places).toHaveLength(8)
    expect(updated.snapshot.items).toEqual(expect.arrayContaining([expect.objectContaining({ arrivalTime: '10:15', note: '新版備註' })]))
    for (const id of ids(updated.snapshot)) expect(ids(row.snapshot)).not.toContain(id)
    expect(await db.itineraryItems.where('tripId').equals(copy.id).toArray()).toEqual(savedCopy)
    expect(await db.publicItineraries.count()).toBe(1)
  })

  it.each(['update', 'withdraw'] as const)('%s rejects missing public ID or mismatched source without changes', async (operation) => {
    const row = await core.publish(sourceId)
    const before = await allRows()
    await expect(core[operation]('missing', sourceId)).rejects.toMatchObject({ code: 'PUBLIC_NOT_FOUND' })
    await expect(core[operation](row.id, 'other-trip')).rejects.toMatchObject({ code: 'SOURCE_MISMATCH' })
    expect(await allRows()).toEqual(before)
  })

  it('rejects update after source deletion but allows explicit withdrawal', async () => {
    const row = await core.publish(sourceId)
    await db.trips.delete(sourceId)
    await expect(core.update(row.id, sourceId)).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' })
    expect(await core.readSnapshot(row.id)).toEqual(row.snapshot)
    await core.withdraw(row.id, sourceId)
    expect(await core.list()).toEqual([])
  })

  it('withdraws all public entry points, preserves personal data, and republishes with new identity', async () => {
    const row = await core.publish(sourceId)
    await core.apply(row.id)
    const before = await db.trips.toArray()
    await core.withdraw(row.id, sourceId)
    expect(await core.list()).toEqual([])
    expect(await core.findBySource(sourceId)).toBeUndefined()
    await expect(core.readSnapshot(row.id)).rejects.toMatchObject({ code: 'PUBLIC_NOT_FOUND' })
    await expect(core.apply(row.id)).rejects.toMatchObject({ code: 'PUBLIC_NOT_FOUND' })
    expect(await db.trips.toArray()).toEqual(before)
    const newRow = await core.publish(sourceId)
    expect(newRow.id).not.toBe(row.id)
    expect(Date.parse(newRow.createdAt)).toBeGreaterThanOrEqual(Date.parse(row.createdAt))
    expect(newRow.updatedAt).toBeNull()
  })
})

describe('apply and transaction contracts', () => {
  it('rolls back the copied region when creating its sharing label fails', async () => {
    const row = await core.publish(sourceId)
    const before = await allRows()
    const fail = () => { throw new Error('label creation failed') }
    db.labels.hook('creating', fail)
    try {
      await expect(core.apply(row.id)).rejects.toThrow('label creation failed')
      expect(await allRows()).toEqual(before)
    } finally {
      db.labels.hook('creating').unsubscribe(fail)
    }
  })

  it('preserves map fields, empty notes and zero route values through publish and apply', async () => {
    await db.regions.update('demo-kyoto', {
      center: { latitude: 35.01, longitude: 135.76 }, googlePlaceId: 'region-google-id',
    })
    const original = createDemoDataset().items[0]
    await db.itineraryItems.update(original.id, {
      durationMinutes: 0, travelDurationMinutes: 0, travelDistanceMeters: 0, transport: '', note: '',
    })
    await db.places.update(original.placeId, { googlePlaceId: 'place-google-id' })
    const row = await core.publish(sourceId)
    expect(row.snapshot.region).toMatchObject({
      center: { latitude: 35.01, longitude: 135.76 }, googlePlaceId: 'region-google-id',
    })
    const expected = { durationMinutes: 0, travelDurationMinutes: 0, travelDistanceMeters: 0, transport: '', note: '' }
    expect(row.snapshot.items).toEqual(expect.arrayContaining([expect.objectContaining(expected)]))
    const trip = await core.apply(row.id)
    expect(await db.regions.get(trip.regionId)).toMatchObject({ center: row.snapshot.region.center })
    expect(await db.itineraryItems.where('tripId').equals(trip.id).toArray())
      .toEqual(expect.arrayContaining([expect.objectContaining(expected)]))
    expect(await db.places.where('regionIds').equals(trip.regionId).toArray())
      .toEqual(expect.arrayContaining([expect.objectContaining({ googlePlaceId: 'place-google-id' })]))
  })

  it('serializes concurrent applications and selects the first free exact copy name', async () => {
    const row = await core.publish(sourceId)
    const copies = await Promise.all([core.apply(row.id), core.apply(row.id)])
    expect(new Set(copies.map(copy => copy.name)).size).toBe(2)
    const firstName = `${row.snapshot.trip.name}（副本）`
    await db.trips.delete(copies.find(copy => copy.name === firstName)!.id)
    expect((await core.apply(row.id)).name).toBe(firstName)
  })

  it('creates distinct personal graphs on repeated application without merging existing entities', async () => {
    const row = await core.publish(sourceId)
    const first = await core.apply(row.id)
    const second = await core.apply(row.id)
    expect(first.name).toBe(`${row.snapshot.trip.name}（副本）`)
    expect(second.name).toBe(`${row.snapshot.trip.name}（副本 2）`)
    expect(first.regionId).not.toBe(second.regionId)
    expect(await db.regions.count()).toBe(4)
    expect(await db.places.count()).toBe(28)
    expect(await db.trips.count()).toBe(3)
    expect(await db.labels.count()).toBe(3)
    const firstItems = await db.itineraryItems.where('tripId').equals(first.id).toArray()
    const secondItems = await db.itineraryItems.where('tripId').equals(second.id).toArray()
    expect(firstItems).toHaveLength(10)
    expect(secondItems).toHaveLength(10)
    expect(firstItems.map(withoutIds)).toEqual(expect.arrayContaining(row.snapshot.items.map(withoutIds)))
    for (const copy of [first, second]) {
      expect(copy.startDate).toBe(row.snapshot.trip.startDate)
      expect(copy.endDate).toBe(row.snapshot.trip.endDate)
      const places = await db.places.where('regionIds').equals(copy.regionId).toArray()
      expect(places).toHaveLength(9)
      expect(await db.regions.get(copy.regionId)).toMatchObject({ name: `${row.snapshot.region.name}(分享)` })
      const labelIds = new Set(places.flatMap(place => place.labelIds))
      expect(labelIds.size).toBe(1)
      const labelId = [...labelIds][0]
      const label = await db.labels.get(labelId)
      expect(label).toMatchObject({ name: `${row.snapshot.trip.name}(分享)` })
      expect(label!.color).toMatch(/^#[0-9a-f]{6}$/i)
      expect(labelId).not.toBe('demo-private')
      for (const place of places) {
        expect(place.labelIds).toEqual([labelId])
        expect(place).not.toHaveProperty('notes')
        expect(place.regionIds).toEqual([copy.regionId])
      }
      const items = await db.itineraryItems.where('tripId').equals(copy.id).toArray()
      const copiedIds = [copy.id, copy.regionId, ...places.map(place => place.id), ...items.map(item => item.id)]
      expect(new Set(copiedIds).size).toBe(copiedIds.length)
      for (const id of copiedIds) expect(ids(row.snapshot)).not.toContain(id)
      for (const item of items) expect(places.some(place => place.id === item.placeId)).toBe(true)
      const temple = places.find(place => place.name === '清水寺')!
      expect(items.filter(item => item.placeId === temple.id)).toHaveLength(2)
    }
    expect((await db.places.where('regionIds').equals(first.regionId).first())!.labelIds)
      .not.toEqual((await db.places.where('regionIds').equals(second.regionId).first())!.labelIds)
    for (const item of firstItems) expect(secondItems.some(other => other.id === item.id || other.placeId === item.placeId)).toBe(false)
    await db.itineraryItems.update(firstItems[0].id, { note: '只改第一份副本' })
    expect(await db.itineraryItems.where('tripId').equals(second.id).toArray()).toEqual(secondItems)
    expect(await core.readSnapshot(row.id)).toEqual(row.snapshot)
  })

  it('avoids colliding copy names even when previous copies were deleted', async () => {
    const row = await core.publish(sourceId)
    const first = await core.apply(row.id)
    const second = await core.apply(row.id)
    await db.trips.delete(first.id)
    const third = await core.apply(row.id)
    expect(third.name).not.toBe(second.name)
  })

  it.each(['publish', 'update', 'apply', 'withdraw'] as const)('%s rejects write failures with complete rollback', async (operation) => {
    const row = operation === 'publish' ? undefined : await core.publish(sourceId)
    const before = await allRows()
    const fail = () => { throw new Error('injected write failure') }
    const target = operation === 'apply' ? db.itineraryItems : db.publicItineraries
    const hook = operation === 'withdraw' ? 'deleting' : operation === 'update' ? 'updating' : 'creating'
    if (hook === 'creating') target.hook('creating', fail)
    else if (hook === 'updating') target.hook('updating', fail)
    else target.hook('deleting', fail)
    try {
      const result = operation === 'publish' ? core.publish(sourceId)
        : operation === 'apply' ? core.apply(row!.id)
        : core[operation](row!.id, sourceId)
      await expect(result).rejects.toThrow('injected write failure')
      expect(await allRows()).toEqual(before)
    } finally {
      target.hook(hook).unsubscribe(fail)
    }
  })
})
