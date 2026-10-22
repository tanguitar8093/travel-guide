import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Place, Region } from '../../database/models'

const mocks = vi.hoisted(() => ({
  provider: 'google', details: vi.fn(), region: vi.fn(), places: vi.fn(),
}))
vi.mock('../../database', () => ({
  regions: { getById: mocks.region }, places: { findByRegionId: mocks.places },
}))
vi.mock('../../geo/provider-preference', () => ({ getMapProvider: () => mocks.provider }))
vi.mock('../place/google-places.service', () => ({ getGooglePlaceDetails: mocks.details }))

import { ItineraryMapService } from './itinerary-map.service'
import { osmDefaultBounds, osmDefaultCenter } from '../../geo/adapters/osm/osm-resources'

const region: Region = { id: 'region', name: '沖繩', googlePlaceId: 'google-region', zoom: 11 }
function place(id: string, rest: Partial<Place> = {}): Place {
  return { id, name: id, regionIds: [region.id], labelIds: [], ...rest }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.provider = 'google'
  mocks.region.mockResolvedValue(region)
  mocks.places.mockResolvedValue([])
})

describe('real itinerary provider resolution', () => {
  it('preserves the original Google details and viewport path', async () => {
    const viewport = { north: 27, south: 26, east: 129, west: 127 }
    mocks.details.mockResolvedValueOnce({ location: { lat: 26.2, lng: 127.6 }, viewport })
      .mockResolvedValueOnce({ location: { lat: 26.3, lng: 127.7 } })
    const result = await new ItineraryMapService().loadRecords(region, [
      place('google', { googlePlaceId: 'google-place' }),
      place('url', { mapsUrl: 'https://example.com/map' }),
    ])
    expect(mocks.details.mock.calls).toEqual([['google-region'], ['google-place']])
    expect(result).toMatchObject({
      regionId: region.id, center: { lat: 26.2, lng: 127.6 }, zoom: 11, viewport,
      markers: [{ id: 'google', title: 'google', position: { lat: 26.3, lng: 127.7 } }],
      unlocatedPlaces: [{ id: 'url' }],
    })
  })

  it('retains the original Google legacy-center fallback and explicit warning', async () => {
    mocks.details.mockRejectedValue(new Error('Google unavailable'))
    const result = await new ItineraryMapService().loadRecords({
      ...region, center: { latitude: 26.4, longitude: 127.8 },
    }, [])
    expect(result.center).toEqual({ lat: 26.4, lng: 127.8 })
    expect(result.regionWarning).toContain('Google unavailable')
  })

  it('uses only validated independent locations in OSM, never Google IDs or URL guesses', async () => {
    mocks.provider = 'osm'
    const result = await new ItineraryMapService().loadRecords(region, [
      place('osm', { googlePlaceId: 'also-google', location: {
        source: 'osm', kind: 'point', reference: { provider: 'osm', id: 'node/123' },
        coordinate: { latitude: 26.3, longitude: 127.7 },
      } }),
      place('picked', { location: { source: 'user', kind: 'user-picked', coordinate: { latitude: 26.4, longitude: 127.8 } } }),
      place('legacy-user', { location: { source: 'legacy-user', kind: 'point', coordinate: { latitude: 26.5, longitude: 127.9 } } }),
      place('google', { googlePlaceId: 'google-only' }),
      place('url', { mapsUrl: 'https://www.google.com/maps/@26.3,127.7,15z' }),
    ])
    expect(mocks.details).not.toHaveBeenCalled()
    expect(result.provider).toBe('osm')
    expect(result.markers.map(marker => marker.id)).toEqual(['osm', 'picked', 'legacy-user'])
    expect(result.unlocatedPlaces.map(item => item.id)).toEqual(['google', 'url'])
    expect(result.center).toEqual({ lat: osmDefaultCenter.latitude, lng: osmDefaultCenter.longitude })
    expect(result.viewport).toEqual(osmDefaultBounds)
    expect(result.regionWarning).toContain('沖繩圖資範圍')
  })

  it('does not reuse a legacy region center without confirmed provenance in OSM', async () => {
    mocks.provider = 'osm'
    const result = await new ItineraryMapService().loadRecords({
      ...region, center: { latitude: 35, longitude: 139 },
    }, [])
    expect(result.center).not.toEqual({ lat: 35, lng: 139 })
    expect(result.regionWarning).toContain('尚無已確認來源')
    expect(mocks.details).not.toHaveBeenCalled()
  })

  it('uses a confirmed region center without a Google request', async () => {
    mocks.provider = 'osm'
    const result = await new ItineraryMapService().loadRecords({
      ...region, center: { latitude: 26.5, longitude: 127.8 },
      centerMetadata: { source: 'user', kind: 'map-center' },
    }, [])
    expect(result.center).toEqual({ lat: 26.5, lng: 127.8 })
    expect(result.zoom).toBe(11)
    expect(result.regionWarning).toBeUndefined()
    expect(mocks.details).not.toHaveBeenCalled()
  })

  it('shows invalid stored locations as unlocated instead of falling back to Google', async () => {
    mocks.provider = 'osm'
    const result = await new ItineraryMapService().loadRecords(region, [place('bad', {
      googlePlaceId: 'do-not-resolve',
      location: { source: 'user', kind: 'point', coordinate: { latitude: NaN, longitude: 127 } },
    })])
    expect(result.markers).toEqual([])
    expect(result.unlocatedPlaces).toMatchObject([{ id: 'bad', reason: expect.stringContaining('Latitude') }])
    expect(mocks.details).not.toHaveBeenCalled()
  })

  it('rejects malformed region coordinates rather than rendering an invalid center', async () => {
    mocks.provider = 'osm'
    await expect(new ItineraryMapService().loadRecords({
      ...region, center: { latitude: 100, longitude: 127 },
      centerMetadata: { source: 'user', kind: 'map-center' },
    }, [])).rejects.toThrow('Latitude')
    expect(mocks.details).not.toHaveBeenCalled()
  })

  it('captures the selected provider before an asynchronous repository read', async () => {
    mocks.provider = 'osm'
    const pending = new ItineraryMapService().loadMapData(region.id)
    mocks.provider = 'google'
    expect((await pending).provider).toBe('osm')
    expect(mocks.details).not.toHaveBeenCalled()
  })
})
