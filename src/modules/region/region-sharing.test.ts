import { expect, it } from 'vitest'
import type { Region, Trip } from '../../database/models'
import type { PublicItinerary } from '../public-itinerary/models'
import type { SharedTripSnapshot } from '../../database/shared-trip.types'
import { regionSharingCounts } from './region-sharing'

const regions: Region[] = [
  { id: 'okinawa', name: '沖繩', mapProvider: 'osm', zoom: 8 },
  { id: 'taiwan', name: '台灣', mapProvider: 'osm', osmDataset: 'taiwan', zoom: 8 },
  { id: 'japan', name: '日本', mapProvider: 'osm', osmDataset: 'japan', zoom: 8 },
  { id: 'google', name: '日本', zoom: 8 },
]
function publication(sourceTripId: string, region: Region): PublicItinerary {
  return { id: sourceTripId, sourceTripId, createdAt: '', updatedAt: null,
    snapshot: { schemaVersion: 1, region, trip: { id: 'snapshot-trip', name: '旅程', regionId: region.id, startDate: '', endDate: '' }, places: [], items: [] } }
}
function collaboration(region: Region): SharedTripSnapshot {
  return { id: region.id, version: '1', document: { region, trip: {
    id: 'shared-trip', name: '旅程', regionId: region.id, startDate: '', endDate: '', ownerUid: 'other', access: 'editor', aclVersion: '1',
  }, places: [], items: [] } }
}

it('counts publications by their source map and snapshots by OSM dataset despite regenerated IDs', () => {
  const trips: Trip[] = [{ id: 'source', name: '旅程', regionId: 'taiwan', startDate: '', endDate: '' }]
  const counts = regionSharingCounts(regions, trips, [
    publication('source', { ...regions[1], id: 'cloned-taiwan' }),
    publication('deleted-source', { ...regions[2], id: 'cloned-japan' }),
  ], [collaboration({ ...regions[2], id: 'another-account-japan' }), { id: 'cancelled', version: '2', document: null }])
  expect(counts.get('taiwan')).toEqual({ published: 1, collaborative: 0 })
  expect(counts.get('japan')).toEqual({ published: 1, collaborative: 1 })
  expect(counts.get('okinawa')).toEqual({ published: 0, collaborative: 0 })
  expect(counts.get('google')).toEqual({ published: 0, collaborative: 0 })
})

it('keeps legacy Okinawa defaults and Google maps isolated', () => {
  const counts = regionSharingCounts(regions, [], [publication('old-source', { ...regions[0], id: 'snapshot-old' })], [
    collaboration(regions[3]), collaboration({ ...regions[3], id: 'other-google' }),
  ])
  expect(counts.get('okinawa')?.published).toBe(1)
  expect(counts.get('google')?.collaborative).toBe(1)
  expect(counts.get('japan')).toEqual({ published: 0, collaborative: 0 })
})

it('counts the published map even when the private source has since moved', () => {
  const source: Trip = { id: 'source', name: '旅程', regionId: 'japan', startDate: '', endDate: '' }
  const counts = regionSharingCounts(regions, [source], [publication('source', { ...regions[1], id: 'snapshot' })], [])
  expect(counts.get('taiwan')?.published).toBe(1)
  expect(counts.get('japan')?.published).toBe(0)
})
