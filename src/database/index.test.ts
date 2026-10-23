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

  it.each(['indexeddb', 'supabase'] as const)(
    'forwards new location formats to the existing %s backend without dropping fields', async mode => {
      const runtime = await import('./runtime')
      vi.spyOn(runtime, 'getDatabaseMode').mockReturnValue(mode)
      const { places, regions, routeMaps, routeMapPlaces } = await import('./index')
      const indexed = await import('./repositories')
      const routeMapRepository = await import('./route-map.repository')
      const cloud = await import('./supabase.repositories')
      const cloudRegions = await import('./supabase.region.repository')
      const cloudMaps = await import('./supabase.route-map.repository')
      const placeBackend = mode === 'indexeddb' ? indexed.places : cloud.supabasePlaces
      const regionBackend = mode === 'indexeddb' ? indexed.regions : cloudRegions.supabaseRegions
      const mapBackend = mode === 'indexeddb' ? routeMapRepository.routeMaps : cloudMaps.supabaseRouteMaps
      const markerBackend = mode === 'indexeddb' ? routeMapRepository.routeMapPlaces : cloudMaps.supabaseRouteMapPlaces
      const placeCreate = vi.spyOn(placeBackend, 'create').mockResolvedValue('place')
      const placeUpdate = vi.spyOn(placeBackend, 'update').mockResolvedValue(undefined)
      const regionCreate = vi.spyOn(regionBackend, 'create').mockResolvedValue('region')
      const regionUpdate = vi.spyOn(regionBackend, 'update').mockResolvedValue(undefined)
      const routeCreate = vi.spyOn(mapBackend, 'create').mockResolvedValue('map')
      const routeUpdate = vi.spyOn(mapBackend, 'update').mockResolvedValue(undefined)
      const markerCreate = vi.spyOn(markerBackend, 'create').mockResolvedValue('marker')
      const markerUpdate = vi.spyOn(markerBackend, 'update').mockResolvedValue(undefined)
      const location = { source: 'user', kind: 'user-picked', coordinate: { latitude: 26.4, longitude: 127.9 } } as const
      const writes = [
        () => places.create({ name: 'Place', regionIds: [], labelIds: [], location }),
        () => places.update('place', { location }),
        () => places.update('place', { location: undefined }),
        () => regions.create({
          name: 'Region', center: location.coordinate, centerMetadata: { source: 'user', kind: 'map-center' }, zoom: 12,
        }),
        () => regions.update('region', { centerMetadata: undefined }),
      ]
      const origin = { kind: 'place', placeId: 'place' } as const
      writes.push(
        () => routeMaps.create({ name: 'Map', transport: 'WALKING', origin }),
        () => routeMaps.update('map', { destination: undefined }),
        () => routeMapPlaces.create({ routeMapId: 'map', name: 'Marker', location }),
        () => routeMapPlaces.update('marker', { location: undefined }),
      )
      for (const write of writes) await write()
      expect(placeCreate).toHaveBeenCalled()
      expect(placeUpdate).toHaveBeenCalled()
      expect(regionCreate).toHaveBeenCalled()
      expect(regionUpdate).toHaveBeenCalled()
      expect(routeCreate).toHaveBeenCalled()
      expect(routeUpdate).toHaveBeenCalled()
      expect(markerCreate).toHaveBeenCalled()
      expect(markerUpdate).toHaveBeenCalled()
      expect(placeCreate.mock.calls[0][0]).toHaveProperty('location', location)
      expect(routeCreate.mock.calls[0][0]).toHaveProperty('origin', origin)
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
