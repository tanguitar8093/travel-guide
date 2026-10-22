import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { googleMapsNavigationUrl, routeOsmLocations, searchOsmLocations, suggestedOsmLocationName } from './osm-service'

const request = vi.fn()
const origin = { latitude: 26.2, longitude: 127.6 }
const destination = { latitude: 26.3, longitude: 127.7 }

beforeEach(() => {
  request.mockReset()
  vi.stubGlobal('fetch', request)
  vi.stubGlobal('window', { location: { origin: 'https://travel.example.test' } })
  vi.stubEnv('VITE_OSM_SERVICE_URL', 'https://maps.example.test')
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

it('normalizes full OSM identities with provenance, representative point kind and dataset version', async () => {
  request.mockResolvedValue(new Response(JSON.stringify({
    dataTimestamp: '2026-10-20', results: [
      { id: 'osm-node-123', name: '入口', coordinates: [127.6, 26.2], address: '那霸' },
      { id: 'osm-way-456', name: '建物', coordinates: [127.7, 26.3] },
      { id: 'relation/789', name: '區域', coordinates: [127.8, 26.4] },
    ],
  })))
  const candidates = await searchOsmLocations('首里城')
  expect(candidates.map(row => row.id)).toEqual(['node/123', 'way/456', 'relation/789'])
  expect(candidates[0].location).toEqual({
    source: 'osm', kind: 'point', reference: { provider: 'osm', id: 'node/123' },
    coordinate: origin, datasetVersion: '2026-10-20',
  })
  expect(candidates[1].location.kind).toBe('approximate-center')
  expect(request.mock.calls[0][0]).toBe('https://maps.example.test/api/search?q=' + encodeURIComponent('首里城'))
})

it('accepts explicitly entered user coordinates without a network request or fake OSM reference', async () => {
  const [candidate] = await searchOsmLocations('26.2, 127.6')
  expect(candidate.location).toEqual({ source: 'user', kind: 'user-picked', coordinate: origin })
  expect(suggestedOsmLocationName(candidate)).toBe('')
  expect(googleMapsNavigationUrl(candidate.location.coordinate)).toBe('https://www.google.com/maps/dir/?api=1&destination=26.2,127.6')
  expect(request).not.toHaveBeenCalled()
})

it('parses exact Google place pins through the maps project parser and retains navigation URLs', async () => {
  request.mockResolvedValue(new Response(JSON.stringify({
    name: 'Kaichu Rd, Uruma, Okinawa, 日本', lat: 26.3316539, lng: 127.927996, inBounds: true,
    resolved_url: 'https://www.google.com/maps/place/Kaichu+Rd,+Uruma,+Okinawa,+日本/@26.3316587,127.9254157,17z/data=!3m1!4b1!4m6!3m5!1s0x34e509b449e6e1f5:0x6961d4cf7583cfb0!8m2!3d26.3316539!4d127.927996!16s/m/0j_5g8l?authuser=0&entry=ttu',
    locationKind: 'pin',
  })))
  const url = 'https://www.google.com/maps/place/Kaichu+Rd,+Uruma,+Okinawa,+%E6%97%A5%E6%9C%AC/@26.3316587,127.9254157,17z/data=!3m1!4b1!4m6!3m5!1s0x34e509b449e6e1f5:0x6961d4cf7583cfb0!8m2!3d26.3316539!4d127.927996!16s%2Fm%2F0j_5g8l?authuser=0&entry=ttu&g_ep=EgoyMDI2MTAxOS4wIKXMDSoASAFQAw%3D%3D'
  const [candidate] = await searchOsmLocations(url)
  expect(candidate).toMatchObject({
    name: 'Kaichu Rd, Uruma, Okinawa, 日本',
    location: { source: 'user', kind: 'user-picked', coordinate: { latitude: 26.3316539, longitude: 127.927996 } },
  })
  expect(suggestedOsmLocationName(candidate)).toBe('Kaichu Rd, Uruma, Okinawa, 日本')
  expect(candidate.mapsUrl).toContain('google.com/maps/place/Kaichu')
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ url })
  expect(request.mock.calls[0][0]).toBe('https://maps.example.test/api/parse-map-url')
})

it.each([
  'https://www.google.com/maps/place/Shuri+Castle/@26.2,127.6,17z',
  'https://maps.google.com/maps?q=26.2,127.6',
  'https://www.google.com/maps/embed?pb=!3d26.2!2d127.6',
  'https://maps.app.goo.gl/short-link',
  'https://goo.gl/maps/short-link',
  'maps.google.co.jp/maps?q=26.2,127.6',
])('passes supported Google Maps URL format to the maps project parser: %s', async url => {
  request.mockResolvedValue(new Response(JSON.stringify({
    name: '地點', lat: 26.2, lng: 127.6, inBounds: true,
    resolved_url: url.startsWith('http') ? url : `https://${url}`, locationKind: 'query-coordinate',
  })))
  const [candidate] = await searchOsmLocations(url)
  expect(candidate.location.source).toBe('user')
  expect(request).toHaveBeenCalledWith('https://maps.example.test/api/parse-map-url', expect.objectContaining({
    method: 'POST', body: JSON.stringify({ url }),
  }))
  expect(suggestedOsmLocationName(candidate)).toBe('地點')
})

it('marks view-center URLs for confirmation and rejects places outside local map coverage', async () => {
  request.mockResolvedValueOnce(new Response(JSON.stringify({
    name: '附近', lat: 26.2, lng: 127.6, inBounds: true, resolved_url: 'https://maps.google.com/maps/@26.2,127.6,17z', locationKind: 'map-center',
  })))
  const [center] = await searchOsmLocations('https://maps.google.com/maps/@26.2,127.6,17z')
  expect(center.location.kind).toBe('map-center')
  expect(center.warning).toContain('不一定是地點入口')
  expect(suggestedOsmLocationName(center)).toBe('附近')
  request.mockResolvedValueOnce(new Response(JSON.stringify({
    name: '台北', lat: 25.03, lng: 121.56, inBounds: false, warning: '超出沖繩圖資範圍',
    resolved_url: 'https://www.google.com/maps?q=25.03,121.56',
  })))
  await expect(searchOsmLocations('https://www.google.com/maps?q=25.03,121.56')).rejects.toThrow('超出沖繩圖資範圍')
})

it('rejects invalid parser responses and malformed coordinate input', async () => {
  request.mockResolvedValue(new Response(JSON.stringify({ name: 'bad', lat: 26.2, lng: 127.6, inBounds: true, resolved_url: 'x' })))
  await expect(searchOsmLocations('https://maps.google.com/?q=26.2,127.6')).rejects.toThrow('格式不正確')
  await expect(searchOsmLocations('91, 127')).rejects.toThrow('Latitude')
  await expect(searchOsmLocations('26.2 127.6')).rejects.toThrow('緯度')
})

it.each([
  { id: 'google-id', name: 'wrong', coordinates: [127, 26] },
  { id: 'osm-node-1', name: 'wrong', coordinates: [181, 26] },
  { id: 'osm-node-1', name: 'wrong', coordinates: [127, '26'] },
])('rejects malformed provider results without silently omitting them', async entry => {
  request.mockResolvedValue(new Response(JSON.stringify({ results: [entry] })))
  await expect(searchOsmLocations('name')).rejects.toThrow()
})

it('sends only independent coordinates and supported mode to the static router', async () => {
  request.mockResolvedValue(new Response(JSON.stringify({ duration: 61.4, distance: 1234.6 })))
  expect(await routeOsmLocations(origin, destination, 'DRIVING')).toEqual({ durationMinutes: 2, distanceMeters: 1235 })
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ points: [[127.6, 26.2], [127.7, 26.3]], mode: 'car' })
})

it('does not fallback to Google for unsupported modes or service errors', async () => {
  await expect(routeOsmLocations(origin, destination, 'TRANSIT')).rejects.toThrow('不會改用 Google')
  expect(request).not.toHaveBeenCalled()
  request.mockResolvedValue(new Response(JSON.stringify({ error: '超出圖資範圍' }), { status: 400 }))
  await expect(routeOsmLocations(origin, destination, 'WALKING')).rejects.toThrow('超出圖資範圍')
})

it('rejects invalid successful route responses rather than generating a zero-duration fallback', async () => {
  request.mockResolvedValue(new Response(JSON.stringify({ duration: -1, distance: 100 })))
  await expect(routeOsmLocations(origin, destination, 'BICYCLING')).rejects.toThrow('時間與距離')
})

it('aborts before a request and requires production service configuration', async () => {
  const abort = new AbortController()
  abort.abort()
  await expect(searchOsmLocations('首里城', abort.signal)).rejects.toMatchObject({ code: 'CANCELLED' })
  expect(request).not.toHaveBeenCalled()
  vi.stubEnv('DEV', false)
  vi.stubEnv('VITE_OSM_SERVICE_URL', '')
  await expect(searchOsmLocations('首里城')).rejects.toThrow('VITE_OSM_SERVICE_URL')
})
