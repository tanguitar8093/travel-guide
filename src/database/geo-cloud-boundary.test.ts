import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const network = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), auth: { getUser: vi.fn() } }))
vi.mock('./supabase.client', () => ({ supabase: network }))

import { SupabasePlaceRepository, SupabaseBackupRepository } from './supabase.repositories'
import { SupabaseRegionRepository } from './supabase.region.repository'
import { SupabaseRouteMapPlaceRepository, SupabaseRouteMapRepository } from './supabase.route-map.repository'

const location = { source: 'user', kind: 'user-picked', coordinate: { latitude: 26.4, longitude: 127.9 } } as const
const emptyV3 = {
  format: 'travel-planner-backup', version: 3, exportedAt: '2026-10-23T00:00:00.000Z',
  data: { regions: [], places: [], labels: [], trips: [], itineraryItems: [], routeMaps: [], routeMapPlaces: [] },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('window', { setTimeout, clearTimeout })
})
afterEach(() => vi.unstubAllGlobals())

describe('geo cloud boundary', () => {
  it('saves a stored place and its associations with one atomic RPC', async () => {
    const input = { name: 'Place', location, regionIds: ['region'], labelIds: [] }
    network.rpc.mockImplementation(async (_name, { p_id }) => ({ data: p_id, error: null }))
    const id = await new SupabasePlaceRepository().create(input)
    expect(network.rpc).toHaveBeenCalledExactlyOnceWith('app_save_place', { p_id: id, p_record: input, p_create: true })
    expect(network.from).not.toHaveBeenCalled()
  })

  it('preserves region metadata, structured endpoints and stored marker positions in cloud mappings', async () => {
    const query = {
      insert: vi.fn().mockReturnThis(), update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { id: 'created' }, error: null }),
      maybeSingle: vi.fn(),
    }
    network.from.mockReturnValue(query)
    network.auth.getUser.mockResolvedValue({ data: { user: { id: 'owner' } }, error: null })
    const region = {
      name: 'Region', mapProvider: 'osm' as const, center: location.coordinate,
      centerMetadata: { source: 'user' as const, kind: 'map-center' as const }, zoom: 9.5,
    }
    await new SupabaseRegionRepository().create(region)
    expect(query.insert).toHaveBeenLastCalledWith(expect.objectContaining({
      osm_dataset: null, map_provider: 'osm', center_metadata: region.centerMetadata, zoom: 9.5,
    }))
    const origin = { kind: 'location', id: 'origin', value: { kind: 'stored', name: 'Origin', location } } as const
    await new SupabaseRouteMapRepository().create({ name: 'Map', transport: 'WALKING', origin })
    expect(query.insert).toHaveBeenLastCalledWith(expect.objectContaining({ origin, destination: null }))
    await new SupabaseRouteMapPlaceRepository().create({ routeMapId: 'map', name: 'Marker', location })
    expect(query.insert).toHaveBeenLastCalledWith(expect.objectContaining({ location, google_place_id: null }))

    query.maybeSingle.mockResolvedValue({ data: {
      id: 'map', name: 'Map', transport: 'WALKING', origin, destination: null,
    }, error: null })
    expect(await new SupabaseRouteMapRepository().getById('map')).toMatchObject({ origin })
    query.maybeSingle.mockResolvedValue({ data: { id: 'marker', route_map_id: 'map', location }, error: null })
    expect(await new SupabaseRouteMapPlaceRepository().getById('marker')).toEqual({ id: 'marker', routeMapId: 'map', location })
  })

  it('routes v3 backup through the existing preview/token guarded replacement RPCs', async () => {
    const counts = { regions: 0, places: 0, labels: 0, trips: 0, itineraryItems: 0, routeMaps: 0, routeMapPlaces: 0 }
    network.rpc.mockResolvedValueOnce({ data: { token: 'preview-token', current: counts, incoming: counts }, error: null })
      .mockResolvedValueOnce({ data: counts, error: null })
    const backups = new SupabaseBackupRepository()
    await backups.previewReplaceAll(emptyV3)
    await backups.replaceAll(emptyV3, 'preview-token')
    expect(network.rpc).toHaveBeenNthCalledWith(1, 'app_backup_preview_replace', { p_backup: emptyV3 })
    expect(network.rpc).toHaveBeenNthCalledWith(2, 'app_backup_apply_replace', { p_backup: emptyV3, p_token: 'preview-token' })
  })
})
