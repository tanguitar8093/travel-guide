import { beforeEach, expect, it, vi } from 'vitest'
import type { Place } from '../../database/models'
import type { GooglePlaceDetails } from '../place/google-places.service'

const mocks = vi.hoisted(() => ({
  list: vi.fn(), getById: vi.fn(), details: vi.fn(), estimate: vi.fn(),
}))
vi.mock('../../database', async () => ({
  ...await import('../../database/errors'),
  places: { list: mocks.list, getById: mocks.getById },
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
  await new RouteCalculatorService().calculate({
    ...input, destination: { source: 'saved', placeId: saved.id },
  })
  expect(mocks.estimate).toHaveBeenCalledWith('station', 'station', 'WALKING')
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
