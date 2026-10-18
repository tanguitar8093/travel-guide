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
})
