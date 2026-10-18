import { beforeEach, expect, it, vi } from 'vitest'
import type { Place } from '../../database/models'
import type { GooglePlaceDetails } from '../place/google-places.service'

const mocks = vi.hoisted(() => ({
  list: vi.fn(), getById: vi.fn(), details: vi.fn(), estimate: vi.fn(),
  trips: vi.fn(), items: vi.fn(),
}))
vi.mock('../../database', async () => ({
  ...await import('../../database/errors'),
  places: { list: mocks.list, getById: mocks.getById },
  trips: { list: mocks.trips },
  itineraryItems: { findByTripId: mocks.items },
}))
vi.mock('../place/google-places.service', () => ({
  getGooglePlaceDetails: mocks.details,
  getGoogleRouteEstimate: mocks.estimate,
  isGooglePlacesConfigured: () => true,
  mountPlaceAutocomplete: vi.fn(),
}))

import { RouteCalculatorService } from './route-calculator.service'
import type { RouteCalculationInput } from './route-calculator.service'

const saved: Place = { id: 'saved', name: '已存車站', googlePlaceId: 'station', regionIds: [], labelIds: [] }
const google: GooglePlaceDetails = {
  id: 'cafe', displayName: 'Google 咖啡店', location: { lat: 25.03, lng: 121.56 },
}
const input: RouteCalculationInput = {
  origin: { source: 'saved', placeId: saved.id },
  destination: { source: 'google', place: google },
  transport: 'WALKING',
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.list.mockResolvedValue([saved])
  mocks.getById.mockResolvedValue(saved)
  mocks.details.mockResolvedValue({ id: 'station', location: { lat: 25.04, lng: 121.55 } })
  mocks.estimate.mockResolvedValue({ durationMinutes: 12, distanceMeters: 800 })
  mocks.items.mockResolvedValue([])
  mocks.trips.mockResolvedValue([])
})

it('reads all saved places through the existing repository without filtering by trip region', async () => {
  expect(await new RouteCalculatorService().listPlaces()).toEqual([saved])
  expect(mocks.list).toHaveBeenCalledExactlyOnceWith()
})

it('supports mixed endpoint sources and reuses coordinates from an already selected Google result', async () => {
  const result = await new RouteCalculatorService().calculate(input)
  expect(result).toMatchObject({
    durationMinutes: 12, distanceMeters: 800, transport: 'WALKING',
    origin: { googlePlaceId: 'station', name: saved.name },
    destination: { googlePlaceId: 'cafe', name: google.displayName, position: google.location },
  })
  expect(mocks.details).toHaveBeenCalledExactlyOnceWith('station')
  expect(mocks.estimate).toHaveBeenCalledExactlyOnceWith('station', 'cafe', 'WALKING')
})

it('supports two freely searched endpoints without database lookup or detail refetches', async () => {
  const other: GooglePlaceDetails = { id: 'other', displayName: '目的地', location: { lat: 24, lng: 121 } }
  await new RouteCalculatorService().calculate({
    origin: { source: 'google', place: google },
    destination: { source: 'google', place: other },
    transport: 'TRANSIT',
  })
  expect(mocks.getById).not.toHaveBeenCalled()
  expect(mocks.details).not.toHaveBeenCalled()
  expect(mocks.estimate).toHaveBeenCalledWith('cafe', 'other', 'TRANSIT')
})

it('supports two saved endpoints through current repository data', async () => {
  mocks.getById.mockResolvedValueOnce(saved).mockResolvedValueOnce({ ...saved, id: 'second', googlePlaceId: 'second-google' })
  mocks.details.mockImplementation(async (id: string) => ({ id, location: { lat: 25, lng: 121 } }))
  await new RouteCalculatorService().calculate({
    ...input, destination: { source: 'saved', placeId: 'second' },
  })
  expect(mocks.estimate).toHaveBeenCalledWith('station', 'second-google', 'WALKING')
})

it('does not request a route for a deleted saved place', async () => {
  mocks.getById.mockResolvedValue(undefined)
  await expect(new RouteCalculatorService().calculate(input)).rejects.toThrow()
  expect(mocks.estimate).not.toHaveBeenCalled()
})

it('explains why custom-URL-only places cannot be used', async () => {
  mocks.getById.mockResolvedValue({ ...saved, googlePlaceId: undefined, mapsUrl: 'https://maps.google.com/' })
  await expect(new RouteCalculatorService().calculate(input)).rejects.toThrow('請改用 Google 搜尋')
  expect(mocks.estimate).not.toHaveBeenCalled()
})

it.each(['', 'FLYING', 'driving'])('rejects unsupported transport %s before external lookups', async (transport) => {
  await expect(new RouteCalculatorService().calculate({ ...input, transport })).rejects.toThrow('交通方式')
  expect(mocks.getById).not.toHaveBeenCalled()
  expect(mocks.estimate).not.toHaveBeenCalled()
})

it('rejects a selected place without usable coordinates', async () => {
  mocks.details.mockResolvedValue({ id: 'station', location: { lat: NaN, lng: 121 } })
  await expect(new RouteCalculatorService().calculate(input)).rejects.toThrow('地圖位置')
  expect(mocks.estimate).not.toHaveBeenCalled()
})

it('surfaces provider failures instead of returning a successful-looking estimate', async () => {
  mocks.estimate.mockRejectedValue(new Error('no route'))
  await expect(new RouteCalculatorService().calculate(input)).rejects.toThrow('no route')
})

it('resolves marker endpoints without reading or writing saved places', async () => {
  await new RouteCalculatorService().calculate({ ...input, origin: { source: 'google', place: { ...google, id: 'marker' } } })
  expect(mocks.getById).not.toHaveBeenCalled()
  expect(mocks.details).not.toHaveBeenCalled()
  expect(mocks.estimate).toHaveBeenCalledWith('marker', 'cafe', 'WALKING')
})

it('rejects the same Google location across different endpoint sources before requesting routes', async () => {
  await expect(new RouteCalculatorService().calculate({
    ...input, origin: { source: 'google', place: google },
  })).rejects.toThrow('出發點與目的地相同')
  expect(mocks.estimate).not.toHaveBeenCalled()
})

it('loads only scheduled places and reports unavailable locations explicitly', async () => {
  mocks.items.mockResolvedValue([
    { placeId: 'saved', date: '2026-10-19' },
    { placeId: 'saved', date: '2026-10-18' },
    { placeId: 'custom', date: '2026-10-18' },
  ])
  mocks.getById.mockImplementation(async (id: string) => id === 'saved' ? saved : { ...saved, id, name: '自訂地點', googlePlaceId: undefined })
  const data = await new RouteCalculatorService().loadTripMarkers('trip')
  expect(mocks.items).toHaveBeenCalledExactlyOnceWith('trip')
  expect(mocks.list).not.toHaveBeenCalled()
  expect(data.dates).toEqual(['2026-10-18', '2026-10-19'])
  expect(data.markers).toHaveLength(1)
  expect(data.markers[0].dates).toEqual(['2026-10-19', '2026-10-18'])
  expect(data.unavailable).toHaveLength(1)
  expect(data.unavailable[0]).toContain('自訂地點')
})

it('shares detail requests only within a service instance and retries failed requests', async () => {
  const service = new RouteCalculatorService()
  await Promise.all([service.resolveEndpoint(input.origin), service.resolveEndpoint(input.origin)])
  expect(mocks.details).toHaveBeenCalledTimes(1)
  await new RouteCalculatorService().resolveEndpoint(input.origin)
  expect(mocks.details).toHaveBeenCalledTimes(2)
  const other = new RouteCalculatorService()
  mocks.details.mockRejectedValueOnce(new Error('temporary'))
  await expect(other.resolveEndpoint(input.origin)).rejects.toThrow('temporary')
  await expect(other.resolveEndpoint(input.origin)).resolves.toMatchObject({ googlePlaceId: 'station' })
})

it('surfaces trip repository failures rather than returning empty success', async () => {
  mocks.items.mockRejectedValue(new Error('read failed'))
  await expect(new RouteCalculatorService().loadTripMarkers('trip')).rejects.toThrow('read failed')
})

it('reads trips through the existing facade', async () => {
  mocks.trips.mockResolvedValue([{ id: 'trip', name: '旅行' }])
  expect(await new RouteCalculatorService().listTrips()).toEqual([{ id: 'trip', name: '旅行' }])
})

it('limits concurrent Google detail requests when loading a large trip', async () => {
  const items = Array.from({ length: 8 }, (_, index) => ({ placeId: `p${index}`, date: '2026-10-18' }))
  mocks.items.mockResolvedValue(items)
  mocks.getById.mockImplementation(async (id: string) => ({ ...saved, id, googlePlaceId: id }))
  let active = 0
  let maximum = 0
  mocks.details.mockImplementation(async (id: string) => {
    active += 1
    maximum = Math.max(maximum, active)
    await new Promise((resolve) => setTimeout(resolve, 0))
    active -= 1
    return { id, location: { lat: 25, lng: 121 } }
  })
  const data = await new RouteCalculatorService().loadTripMarkers('trip')
  expect(data.markers).toHaveLength(8)
  expect(maximum).toBeLessThanOrEqual(3)
})
