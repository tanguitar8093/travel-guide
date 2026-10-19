import { afterEach, expect, it, vi } from 'vitest'
import { SharedTripService } from './shared-trip.service'
import { sharedTrips } from '../../database/shared-trip.repository'
import type { SharedTripDocument, SharedTripSnapshot } from '../../database/shared-trip.types'

const tripId = '11111111-1111-4111-8111-111111111111'
const regionId = '22222222-2222-4222-8222-222222222222'
const placeId = '33333333-3333-4333-8333-333333333333'
const itemId = '44444444-4444-4444-8444-444444444444'
function fixture(): SharedTripSnapshot {
  return {
    id: tripId, version: '1', document: {
      trip: { id: tripId, regionId, ownerUid: tripId, name: 'Trip', startDate: '2026-10-20', endDate: '2026-10-21', access: 'editor', aclVersion: '1' },
      region: { id: regionId, name: 'Kyoto', googlePlaceId: 'kyoto', zoom: 12 },
      places: [{ id: placeId, name: 'Cafe', googlePlaceId: 'cafe' }],
      items: [{ id: itemId, placeId, date: '2026-10-20', order: 0, travelDurationMinutes: 10, travelDistanceMeters: 100 }],
    },
  }
}

function document(row: SharedTripSnapshot): SharedTripDocument {
  if (!row.document) throw new Error('Missing fixture')
  return row.document
}

afterEach(() => vi.restoreAllMocks())

it('shares only selected place map fields, not notes or private collections', async () => {
  const before = fixture()
  const save = vi.spyOn(sharedTrips, 'save').mockImplementation(async (_before, document) => ({ id: tripId, version: '2', document }))
  const result = await new SharedTripService().saveItem(before, {
    id: crypto.randomUUID(), placeId: 'personal', date: '2026-10-20', order: 0,
  }, { id: 'personal', name: 'Park', googlePlaceId: 'park', notes: 'secret', regionIds: ['private-region'], labelIds: ['private-label'] })
  expect(save).toHaveBeenCalledOnce()
  const added = document(result).places.find((place) => place.name === 'Park')
  expect(added).toMatchObject({ name: 'Park', googlePlaceId: 'park' })
  expect(added).not.toHaveProperty('notes')
  expect(added).not.toHaveProperty('labelIds')
  expect(document(result).items[1]).toMatchObject({ placeId: added?.id, order: 1 })
  expect(document(result).items[0].travelDurationMinutes).toBeUndefined()
})

it('keeps travel estimates on note-only edits but clears them on date/place/order changes', async () => {
  vi.spyOn(sharedTrips, 'save').mockImplementation(async (_before, document) => ({ id: tripId, version: '2', document }))
  const before = fixture()
  const item = document(before).items[0]
  const result = await new SharedTripService().saveItem(before, { ...item, note: 'changed' })
  expect(document(result).items[0].travelDurationMinutes).toBe(10)
  const moved = await new SharedTripService().saveItem(before, { ...item, date: '2026-10-21' })
  expect(document(moved).items[0].travelDurationMinutes).toBeUndefined()
})

it('denies viewer mutations and incomplete reorder lists', async () => {
  const service = new SharedTripService()
  const before = fixture()
  const readOnly = { ...before, document: { ...document(before), trip: { ...document(before).trip, access: 'viewer' as const } } }
  expect(() => service.deleteItem(readOnly, itemId)).toThrow('僅供檢視')
  expect(() => service.reorder(before, '2026-10-20', [])).toThrow('已改變')
})
