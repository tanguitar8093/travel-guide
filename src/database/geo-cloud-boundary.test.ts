import { beforeEach, describe, expect, it, vi } from 'vitest'

const network = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), auth: { getUser: vi.fn() } }))
vi.mock('./supabase.client', () => ({ supabase: network }))

import { SupabasePlaceRepository, SupabaseBackupRepository } from './supabase.repositories'
import { SupabaseRegionRepository } from './supabase.region.repository'
import { SupabaseRouteMapPlaceRepository, SupabaseRouteMapRepository } from './supabase.route-map.repository'

const location = { source: 'user', kind: 'user-picked', coordinate: { latitude: 0, longitude: 0 } } as const
const emptyV3 = {
  format: 'travel-planner-backup', version: 3, exportedAt: '2026-10-23T00:00:00.000Z',
  data: { regions: [], places: [], labels: [], trips: [], itineraryItems: [], routeMaps: [], routeMapPlaces: [] },
}

beforeEach(() => vi.clearAllMocks())

describe('unreleased geo cloud boundary', () => {
  it('rejects all new-format create and update operations before network access', async () => {
    const places = new SupabasePlaceRepository()
    const regions = new SupabaseRegionRepository()
    const maps = new SupabaseRouteMapRepository()
    const markers = new SupabaseRouteMapPlaceRepository()
    await expect(places.create({ name: 'Place', location, regionIds: [], labelIds: [] })).rejects.toThrow('尚未支援')
    await expect(places.update('place', { location: undefined })).rejects.toThrow('尚未支援')
    await expect(regions.create({
      name: 'Region', center: location.coordinate, centerMetadata: { source: 'user', kind: 'map-center' }, zoom: 12,
    })).rejects.toThrow('尚未支援')
    await expect(regions.update('region', { centerMetadata: undefined })).rejects.toThrow('尚未支援')
    await expect(maps.create({ name: 'Map', transport: 'WALKING', origin: { kind: 'place', placeId: 'place' } }))
      .rejects.toThrow('尚未支援')
    await expect(maps.update('map', { origin: undefined })).rejects.toThrow('尚未支援')
    await expect(markers.create({ routeMapId: 'map', name: 'Marker', location })).rejects.toThrow('尚未支援')
    await expect(markers.update('marker', { location: undefined })).rejects.toThrow('尚未支援')
    expect(network.from).not.toHaveBeenCalled()
    expect(network.rpc).not.toHaveBeenCalled()
    expect(network.auth.getUser).not.toHaveBeenCalled()
  })

  it('parses backup v3 but never sends it to legacy cloud replacement RPCs', async () => {
    const backups = new SupabaseBackupRepository()
    expect(backups.validateImport(emptyV3).version).toBe(3)
    await expect(backups.previewReplaceAll(emptyV3)).rejects.toThrow('備份 v3')
    await expect(backups.replaceAll(emptyV3, 'preview-token')).rejects.toThrow('備份 v3')
    expect(network.rpc).not.toHaveBeenCalled()
  })
})
