import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ItineraryService } from './itinerary.service'
import { CollaborativeItineraryService } from './collaborative-itinerary.service'
import { sharedTrips } from '../../database/shared-trip.repository'
import { ItineraryMapService } from './itinerary-map.service'
import type { SharedTripSnapshot } from '../../database/shared-trip.types'

vi.mock('../../database/shared-trip.types', () => ({ sharedTripEditingEnabled: true }))

const tripId = '11111111-1111-4111-8111-111111111111'
const regionId = '22222222-2222-4222-8222-222222222222'
const placeId = '33333333-3333-4333-8333-333333333333'
const itemId = '44444444-4444-4444-8444-444444444444'
const trip = { id: tripId, regionId, name: 'Trip', startDate: '2026-10-20', endDate: '2026-10-21' }
const region = { id: regionId, name: 'Kyoto', googlePlaceId: 'kyoto', zoom: 12 }
const personalPlace = { id: placeId, name: 'Cafe', googlePlaceId: 'cafe', regionIds: [regionId], labelIds: ['private-label'], notes: 'private-note' }

function fixture(access: 'owner' | 'editor' | 'viewer' = 'owner'): SharedTripSnapshot {
  return { id: tripId, version: '1', document: {
    trip: { ...trip, ownerUid: tripId, access, aclVersion: '1' },
    region,
    places: [{ id: placeId, name: 'Cafe', icon: '☕', googlePlaceId: 'cafe' }],
    items: [{ id: itemId, placeId, date: trip.startDate, order: 0, note: 'latest shared note' }],
  } }
}

beforeEach(() => {
  vi.spyOn(ItineraryService.prototype, 'loadWorkspace').mockResolvedValue({
    trips: [trip], regions: [region], places: [personalPlace],
  })
  vi.spyOn(sharedTrips, 'list').mockResolvedValue([fixture()])
  vi.spyOn(sharedTrips, 'save').mockImplementation(async (before, document) => ({ ...before, version: '2', document }))
})
afterEach(() => vi.restoreAllMocks())

it('keeps an activated owner trip in the original list exactly once and uses its current shared items', async () => {
  const service = new CollaborativeItineraryService()
  const workspace = await service.loadWorkspace()
  expect(workspace.trips.map((row) => row.id)).toEqual([tripId])
  expect(await service.listItems(tripId)).toEqual([{ ...fixture().document!.items[0], tripId }])
  expect(workspace.places[0]).toMatchObject({ icon: '☕', notes: 'private-note', labelIds: ['private-label'] })
})

it('projects a recipient trip into the same workspace without exposing owner private notes or labels', async () => {
  vi.spyOn(ItineraryService.prototype, 'loadWorkspace').mockResolvedValue({ trips: [], regions: [], places: [] })
  vi.spyOn(sharedTrips, 'list').mockResolvedValue([fixture('editor')])
  const service = new CollaborativeItineraryService()
  const workspace = await service.loadWorkspace()
  expect(workspace.trips).toHaveLength(1)
  expect(workspace.places[0]).toMatchObject({ name: 'Cafe', icon: '☕', labelIds: [] })
  expect(workspace.places[0]).not.toHaveProperty('notes')
  expect(service.getAccess(tripId)).toBe('editor')
})

it('routes original UI item edits to shared persistence, never the retained private rows', async () => {
  const personalUpdate = vi.spyOn(ItineraryService.prototype, 'updateItem')
  const service = new CollaborativeItineraryService()
  await service.loadWorkspace()
  service.beginEdit(tripId)
  await service.updateItem(itemId, { note: 'edited from original UI' })
  expect(sharedTrips.save).toHaveBeenCalledOnce()
  expect(personalUpdate).not.toHaveBeenCalled()
  expect((await service.listItems(tripId))[0].note).toBe('edited from original UI')
})

it('keeps the form opening version when a background reload arrives', async () => {
  const service = new CollaborativeItineraryService()
  await service.loadWorkspace()
  service.beginEdit(tripId)
  vi.spyOn(sharedTrips, 'list').mockResolvedValue([{ ...fixture(), version: '9' }])
  await service.loadWorkspace()
  await service.updateItem(itemId, { note: 'draft' })
  expect(vi.mocked(sharedTrips.save).mock.calls[0][0].version).toBe('1')
})

it('preserves personal operations and removes only the shared overlay after cancellation', async () => {
  const privateItems = vi.spyOn(ItineraryService.prototype, 'listItems').mockResolvedValue([])
  const service = new CollaborativeItineraryService()
  await service.loadWorkspace()
  vi.spyOn(sharedTrips, 'list').mockResolvedValue([{ id: tripId, version: '5', document: null }])
  const workspace = await service.loadWorkspace()
  expect(workspace.trips).toEqual([trip])
  expect(await service.listItems(tripId)).toEqual([])
  expect(privateItems).toHaveBeenCalledWith(tripId)
})

it('rejects viewer writes and editor trip deletion', async () => {
  const service = new CollaborativeItineraryService()
  vi.spyOn(sharedTrips, 'list').mockResolvedValue([fixture('viewer')])
  await service.loadWorkspace()
  await expect(service.updateItem(itemId, { note: 'forbidden' })).rejects.toThrow('僅供檢視')
  expect(sharedTrips.save).not.toHaveBeenCalled()
  vi.spyOn(sharedTrips, 'list').mockResolvedValue([fixture('editor')])
  await service.loadWorkspace()
  await expect(service.deleteTrip(tripId)).rejects.toThrow('擁有者')
})

it('keeps the original region zoom and map loader for personal trips', async () => {
  const personalMap = vi.spyOn(ItineraryService.prototype, 'loadMapData').mockResolvedValue({
    regionId, center: { lat: 1, lng: 2 }, zoom: 12, markers: [], unlocatedPlaces: [],
  })
  vi.spyOn(sharedTrips, 'list').mockResolvedValue([])
  const service = new CollaborativeItineraryService()
  await service.loadWorkspace()
  expect((await service.loadMapData(regionId, tripId)).zoom).toBe(12)
  expect(personalMap).toHaveBeenCalledWith(regionId)
})

it('uses the same region map service and zoom for a shared trip', async () => {
  const map = vi.spyOn(ItineraryMapService.prototype, 'loadRecords').mockResolvedValue({
    regionId, center: { lat: 1, lng: 2 }, zoom: 12, markers: [], unlocatedPlaces: [],
  })
  const service = new CollaborativeItineraryService()
  await service.loadWorkspace()
  expect((await service.loadMapData(regionId, tripId)).zoom).toBe(12)
  expect(map).toHaveBeenCalledWith(region, [expect.objectContaining({ id: placeId, icon: '☕' })])
})
