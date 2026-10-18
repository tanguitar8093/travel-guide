import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const computeRoutes = vi.fn()

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
  class Place {
    id: string
    constructor({ id }: { id: string }) { this.id = id }
  }
  vi.stubGlobal('window', { google: { maps: {
    importLibrary: async (name: string) => name === 'places'
      ? { Place }
      : { Route: { computeRoutes } },
  } } })
  computeRoutes.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it('requests duration and route distance together for the chosen transport mode', async () => {
  computeRoutes.mockResolvedValue({ routes: [{ durationMillis: 61000, distanceMeters: 650 }] })
  const { getGoogleRouteEstimate } = await import('./google-places.service')
  expect(await getGoogleRouteEstimate('origin', 'destination', 'WALKING'))
    .toEqual({ durationMinutes: 2, distanceMeters: 650 })
  expect(computeRoutes).toHaveBeenCalledTimes(1)
  expect(computeRoutes).toHaveBeenCalledWith({
    origin: expect.objectContaining({ id: 'origin' }),
    destination: expect.objectContaining({ id: 'destination' }),
    travelMode: 'WALKING',
    fields: ['durationMillis', 'distanceMeters'],
  })
})

it.each([undefined, -1, 1.2, NaN, Infinity])('reports missing or invalid route distance %s', async (distanceMeters) => {
  computeRoutes.mockResolvedValue({ routes: [{ durationMillis: 60000, distanceMeters }] })
  const { getGoogleRouteEstimate } = await import('./google-places.service')
  await expect(getGoogleRouteEstimate('a', 'b', 'DRIVING')).rejects.toThrow('路線距離')
})

it('accepts a zero-distance route', async () => {
  computeRoutes.mockResolvedValue({ routes: [{ durationMillis: 0, distanceMeters: 0 }] })
  const { getGoogleRouteEstimate } = await import('./google-places.service')
  expect(await getGoogleRouteEstimate('a', 'a', 'TRANSIT'))
    .toEqual({ durationMinutes: 0, distanceMeters: 0 })
})
