import { beforeEach, expect, it, vi } from 'vitest'
import type { ItineraryItem, Place } from '../../database/models'

const mocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  listItems: vi.fn(),
  updateItem: vi.fn(),
  getPlace: vi.fn(),
  estimate: vi.fn(),
}))

vi.mock('../../database', async () => ({
  ...await import('../../database/errors'),
  itineraryItems: {
    getById: mocks.getItem,
    findByTripAndDate: mocks.listItems,
    update: mocks.updateItem,
  },
  places: { getById: mocks.getPlace },
  regions: {},
  trips: {},
}))
vi.mock('../place/google-places.service', () => ({
  getGoogleRouteEstimate: mocks.estimate,
  getGooglePlaceDetails: vi.fn(),
}))

import { ItineraryService } from './itinerary.service'

const first: ItineraryItem = { id: 'first', tripId: 'trip', placeId: 'a', date: '2026-10-18', order: 0 }
const second: ItineraryItem = { id: 'second', tripId: 'trip', placeId: 'b', date: '2026-10-18', order: 1, transport: 'DRIVING' }
const place = (id: string): Place => ({ id, name: id, googlePlaceId: `google-${id}`, regionIds: [], labelIds: [] })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getItem.mockResolvedValue(second)
  mocks.listItems.mockResolvedValue([first, second])
  mocks.getPlace.mockImplementation(async (id: string) => place(id))
  mocks.updateItem.mockResolvedValue(undefined)
  mocks.estimate.mockResolvedValue({ durationMinutes: 25, distanceMeters: 12300 })
})

it('saves time and distance in one existing repository update', async () => {
  const result = await new ItineraryService().calculateTravelDuration(second.id)
  expect(result).toEqual({ durationMinutes: 25, distanceMeters: 12300 })
  expect(mocks.estimate).toHaveBeenCalledWith('google-a', 'google-b', 'DRIVING')
  expect(mocks.updateItem).toHaveBeenCalledExactlyOnceWith('second', {
    travelDurationMinutes: 25, travelDistanceMeters: 12300,
  })
})

it('does not overwrite either estimate after a route request fails', async () => {
  mocks.estimate.mockRejectedValue(new Error('route unavailable'))
  await expect(new ItineraryService().calculateTravelDuration(second.id)).rejects.toThrow('route unavailable')
  expect(mocks.updateItem).not.toHaveBeenCalled()
})

it('rejects results when the predecessor destination changes during calculation', async () => {
  mocks.listItems.mockResolvedValueOnce([first, second])
    .mockResolvedValueOnce([{ ...first, placeId: 'different' }, second])
  await expect(new ItineraryService().calculateTravelDuration(second.id)).rejects.toThrow('重新計算路程')
  expect(mocks.updateItem).not.toHaveBeenCalled()
})

it('rejects results when a place Google ID changes during calculation', async () => {
  mocks.getPlace.mockResolvedValueOnce(place('a')).mockResolvedValueOnce(place('b'))
    .mockResolvedValueOnce({ ...place('a'), googlePlaceId: 'changed' }).mockResolvedValueOnce(place('b'))
  await expect(new ItineraryService().calculateTravelDuration(second.id)).rejects.toThrow('位置已變更')
  expect(mocks.updateItem).not.toHaveBeenCalled()
})
