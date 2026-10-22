import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function createLocalStorageMock() {
  const store = new Map<string, string>()
  return {
    getItem(key: string) {
      return store.has(key) ? store.get(key) ?? null : null
    },
    setItem(key: string, value: string) {
      store.set(key, value)
    },
    removeItem(key: string) {
      store.delete(key)
    },
  }
}

describe('database barrel exports', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('window', {
      localStorage: createLocalStorageMock(),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('exposes the public database API from the barrel', async () => {
    const database = await import('./index')

    expect(typeof database.getDatabaseMode).toBe('function')
    expect(typeof database.setDatabaseMode).toBe('function')
    expect(typeof database.subscribeDatabaseMode).toBe('function')
    expect(typeof database.useDatabaseMode).toBe('function')
    expect(typeof database.regions.list).toBe('function')
    expect(typeof database.places.findByLabelIds).toBe('function')
    expect(typeof database.labels.getDescendantIds).toBe('function')
    expect(typeof database.backupRepository.validateImport).toBe('function')
    expect(typeof database.routeMaps.findByTripId).toBe('function')
    expect(typeof database.routeMapPlaces.findByRouteMapId).toBe('function')
  })

  it.each(['indexeddb', 'supabase', 'hybrid'] as const)(
    'blocks unreleased location writes before dispatch in %s mode', async mode => {
      const runtime = await import('./runtime')
      const selectedMode = vi.spyOn(runtime, 'getDatabaseMode').mockReturnValue(mode)
      const { places, regions, routeMaps, routeMapPlaces, backupRepository, ValidationError } = await import('./index')
      const location = { source: 'user', kind: 'user-picked', coordinate: { latitude: 26, longitude: 127 } } as const
      expect(() => places.create({ name: 'Place', regionIds: [], labelIds: [], location })).toThrow(ValidationError)
      expect(() => places.update('place', { location })).toThrow(ValidationError)
      expect(() => places.update('place', { location: undefined })).toThrow(ValidationError)
      expect(() => regions.create({
        name: 'Region', center: location.coordinate, centerMetadata: { source: 'user', kind: 'map-center' }, zoom: 12,
      })).toThrow(ValidationError)
      expect(() => regions.update('region', { centerMetadata: undefined })).toThrow(ValidationError)
      const origin = { kind: 'place', placeId: 'place' } as const
      expect(() => routeMaps.create({ name: 'Map', transport: 'WALKING', origin })).toThrow(ValidationError)
      expect(() => routeMaps.update('map', { destination: undefined })).toThrow(ValidationError)
      expect(() => routeMapPlaces.create({ routeMapId: 'map', name: 'Marker', location })).toThrow(ValidationError)
      expect(() => routeMapPlaces.update('marker', { location: undefined })).toThrow(ValidationError)
      expect(() => backupRepository.replaceAll({
        format: 'travel-planner-backup', version: 3, exportedAt: '2026-10-23T00:00:00.000Z',
        data: { regions: [], places: [], labels: [], trips: [], itineraryItems: [], routeMaps: [], routeMapPlaces: [] },
      })).toThrow(ValidationError)
      expect(selectedMode).not.toHaveBeenCalled()
    },
  )

  it('continues forwarding original Google and URL writes without changing their inputs', async () => {
    const runtime = await import('./runtime')
    vi.spyOn(runtime, 'getDatabaseMode').mockReturnValue('indexeddb')
    const repositories = await import('./repositories')
    const create = vi.spyOn(repositories.places, 'create').mockResolvedValue('saved-place')
    const update = vi.spyOn(repositories.regions, 'update').mockResolvedValue(undefined)
    const { places, regions } = await import('./index')
    const input = { name: 'Original', googlePlaceId: 'google', regionIds: [], labelIds: [] }
    const changes = { name: 'Region name' }
    expect(await places.create(input)).toBe('saved-place')
    const urlInput = { name: 'URL-only', mapsUrl: 'https://example.com/map', regionIds: [], labelIds: [] }
    expect(await places.create(urlInput)).toBe('saved-place')
    await regions.update('region', changes)
    expect(create).toHaveBeenNthCalledWith(1, input)
    expect(create).toHaveBeenNthCalledWith(2, urlInput)
    expect(update).toHaveBeenCalledExactlyOnceWith('region', changes)
  })
})
