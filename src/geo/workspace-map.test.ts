import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { GoogleMapMarkerData } from '../modules/place/google-places.service'

const mocks = vi.hoisted(() => ({
  createRenderer: vi.fn(), mount: vi.fn(), setMarkers: vi.fn(), fitMarkers: vi.fn(), fitBounds: vi.fn(), destroy: vi.fn(),
  loadSdk: vi.fn(), style: vi.fn(), googleMount: vi.fn(),
}))
vi.mock('./adapters/osm/maplibre-renderer', () => ({ createMapLibreRenderer: mocks.createRenderer }))
vi.mock('./adapters/osm/osm-resources', () => ({ loadOsmMapLibre: mocks.loadSdk, createOsmStyle: mocks.style,
  osmDefaultCenter: { latitude: 26.43, longitude: 127.9 },
  osmDefaultBounds: { north: 26.9, south: 25.98, east: 128.36, west: 127.58 },
}))
vi.mock('../modules/place/google-places.service', () => ({ mountGoogleMap: mocks.googleMount }))

import { mountWorkspaceMap } from './workspace-map'

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('window', { location: { origin: 'https://travel.example.test' } })
  vi.stubGlobal('document', { createElement: () => ({}) })
  vi.stubEnv('VITE_OSM_ASSET_BASE_URL', 'https://maps.example.test/assets/')
  vi.stubEnv('VITE_OSM_STYLE_URL', '')
  mocks.createRenderer.mockReturnValue({ mount: mocks.mount })
  mocks.mount.mockResolvedValue({ setMarkers: mocks.setMarkers, fitMarkers: mocks.fitMarkers, fitBounds: mocks.fitBounds, destroy: mocks.destroy })
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

it('delegates Google to the unchanged original loader and handle', async () => {
  const original = { setMarkers: vi.fn(), destroy: vi.fn() }
  mocks.googleMount.mockResolvedValue(original)
  const host = document.createElement('div')
  const options = { center: { lat: 26, lng: 127 }, zoom: 10 }
  expect(await mountWorkspaceMap('google', host, options, vi.fn())).toBe(original)
  expect(mocks.googleMount).toHaveBeenCalledExactlyOnceWith(host, options)
  expect(mocks.createRenderer).not.toHaveBeenCalled()
  expect(mocks.loadSdk).not.toHaveBeenCalled()
})

it('adapts real itinerary identities, selection callbacks and fitting to the neutral OSM renderer', async () => {
  const onError = vi.fn()
  const handle = await mountWorkspaceMap('osm', document.createElement('div'), {
    center: { lat: 26, lng: 127 }, zoom: 10,
    viewport: { north: 27, south: 25, east: 129, west: 126 },
  }, onError)
  expect(mocks.style).toHaveBeenCalledExactlyOnceWith('https://maps.example.test/assets', 'okinawa')
  const mountOptions = mocks.mount.mock.calls[0][1]
  expect(mountOptions).toMatchObject({
    center: { latitude: 26.44, longitude: 127.97 }, zoom: 8, maxZoom: 17,
    bounds: { north: 26.9, south: 25.98, east: 128.36, west: 127.58 },
  })
  const first = vi.fn()
  const next = vi.fn()
  const markers: GoogleMapMarkerData[] = [
    { id: 'project-id', title: '行程地點', position: { lat: 26.3, lng: 127.8 }, sequence: 1, enlarged: true, onClick: first },
    { id: 'unscheduled', title: '收藏地點', position: { lat: 26.4, lng: 127.9 } },
  ]
  handle.setMarkers(markers)
  expect(mocks.setMarkers).toHaveBeenCalledWith([
    { id: 'project-id', name: '行程地點', coordinate: { latitude: 26.3, longitude: 127.8 }, sequence: 1, color: '#648a74', selected: true },
    { id: 'unscheduled', name: '收藏地點', coordinate: { latitude: 26.4, longitude: 127.9 }, sequence: undefined, color: '#6d91ad', selected: undefined },
  ])
  expect(mocks.fitMarkers).not.toHaveBeenCalled()
  mountOptions.events.onSelect('project-id')
  expect(first).toHaveBeenCalledOnce()
  handle.setMarkers([{ ...markers[0], onClick: next }], { fitBounds: true })
  mountOptions.events.onSelect('project-id')
  expect(next).toHaveBeenCalledOnce()
  expect(first).toHaveBeenCalledOnce()
  expect(mocks.fitMarkers).toHaveBeenCalledOnce()
  handle.resetView()
  expect(mocks.fitBounds).toHaveBeenCalledExactlyOnceWith({ north: 26.9, south: 25.98, east: 128.36, west: 127.58 })
  mountOptions.events.onError(new Error('resource failed'))
  expect(onError).toHaveBeenCalled()
  handle.destroy()
  expect(mocks.destroy).toHaveBeenCalledOnce()
  expect(mocks.googleMount).not.toHaveBeenCalled()
})

it('rejects an already-cancelled mount without starting either provider', async () => {
  const abort = new AbortController()
  abort.abort()
  for (const provider of ['osm', 'google'] as const) {
    await expect(mountWorkspaceMap(provider, document.createElement('div'), {
      center: { lat: 26, lng: 127 }, zoom: 10, signal: abort.signal,
    }, vi.fn())).rejects.toMatchObject({ code: 'CANCELLED' })
  }
  expect(mocks.googleMount).not.toHaveBeenCalled()
  expect(mocks.createRenderer).not.toHaveBeenCalled()
})

it('requires production assets and never silently falls back to Google', async () => {
  vi.stubEnv('DEV', false)
  vi.stubEnv('VITE_OSM_ASSET_BASE_URL', '')
  await expect(mountWorkspaceMap('osm', document.createElement('div'), {
    center: { lat: 26, lng: 127 }, zoom: 10,
  }, vi.fn())).rejects.toThrow('VITE_OSM_ASSET_BASE_URL')
  expect(mocks.googleMount).not.toHaveBeenCalled()
})

it('rejects invalid asset protocols before loading a renderer', async () => {
  vi.stubEnv('VITE_OSM_ASSET_BASE_URL', 'file:///tmp/maps')
  await expect(mountWorkspaceMap('osm', document.createElement('div'), {
    center: { lat: 26, lng: 127 }, zoom: 10,
  }, vi.fn())).rejects.toThrow('HTTP')
  expect(mocks.createRenderer).not.toHaveBeenCalled()
})

it('fits only the selected day pins while retaining unscheduled markers and click targets', async () => {
  const handle = await mountWorkspaceMap('osm', document.createElement('div'), {
    center: { lat: 26, lng: 127 }, zoom: 10,
  }, vi.fn())
  const onClick = vi.fn()
  const markers: GoogleMapMarkerData[] = [
    { id: 'day-1', title: '第一站', position: { lat: 26.1, lng: 127.1 }, sequence: 1, onClick },
    { id: 'day-2', title: '第二站', position: { lat: 26.2, lng: 127.2 }, sequence: 2 },
    { id: 'other', title: '其他收藏', position: { lat: 40, lng: 140 } },
  ]
  handle.setMarkers(markers, { fitBounds: true, fitMarkerIds: ['day-1', 'day-2'] })
  expect(mocks.setMarkers.mock.lastCall?.[0]).toHaveLength(3)
  expect(mocks.fitBounds).toHaveBeenCalledExactlyOnceWith({ north: 26.2, south: 26.1, east: 127.2, west: 127.1 })
  expect(mocks.fitMarkers).not.toHaveBeenCalled()
  mocks.mount.mock.calls[0][1].events.onSelect('day-1')
  expect(onClick).toHaveBeenCalledOnce()
  mocks.fitBounds.mockClear()
  handle.setMarkers(markers, { fitBounds: true, fitMarkerIds: [] })
  expect(mocks.fitBounds).not.toHaveBeenCalled()
})
