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

it('deduplicates nearby results regardless of name and equal names regardless of distance, preserving result order', async () => {
  request.mockResolvedValue(new Response(JSON.stringify({
    results: [
      { id: 'node/1', name: '原地點', coordinates: [127.6, 26.2] },
      { id: 'way/2', name: '另一入口', coordinates: [127.6, 26.2002] },
      { id: 'node/3', name: '原地點', coordinates: [127.7, 26.3] },
      { id: 'node/4', name: '其他地點', coordinates: [127.8, 26.4] },
      { id: 'node/5', name: '附近但超過門檻', coordinates: [127.6, 26.2005] },
    ],
  })))
  expect((await searchOsmLocations('地點')).map(candidate => candidate.id))
    .toEqual(['node/1', 'node/4', 'node/5'])
})

it.each([
  'https://www.google.com/maps/place/Kaichu+Road/data=!3d26.3316539!4d127.927996',
  'https://www.google.com/maps/place/Shuri+Castle/@26.2,127.6,17z',
  'https://maps.google.com/maps?q=26.2,127.6',
  'https://www.google.com/maps/embed?pb=!3d26.2!2d127.6',
  'maps.google.co.jp/maps?q=26.2,127.6',
])('sends every long Maps URL to Mapu even when coordinates are already present: %s', async url => {
  request.mockResolvedValue(new Response(JSON.stringify(unshortened)))
  const [candidate] = await searchOsmLocations(url)
  const normalized = url.startsWith('https://') ? url : 'https://' + url
  expect(request).toHaveBeenCalledTimes(1)
  expect(request).toHaveBeenCalledWith('https://mapu.retiolus.net/unshortener?' + new URLSearchParams({ link: normalized }), expect.any(Object))
  expect(candidate.name).toBe(unshortened.name)
  expect(candidate.mapsUrl).toBe(unshortened.full_link)
  expect(candidate.location.coordinate).toEqual({ latitude: unshortened.lat, longitude: unshortened.long })
})

it('rejects invalid parser responses and malformed coordinate input', async () => {
  request.mockResolvedValue(new Response(JSON.stringify({ name: 'bad', lat: 26.2, lng: 127.6, inBounds: true, resolved_url: 'x' })))
  await expect(searchOsmLocations('https://maps.google.com/?q=26.2,127.6')).rejects.toThrow('格式不正確')
  await expect(searchOsmLocations('91, 127')).rejects.toThrow('緯度')
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

it('returns ordered road geometry when explicitly requested', async () => {
  request.mockResolvedValue(new Response(JSON.stringify({ duration: 80, distance: 900, legs: [
    { geometry: { type: 'LineString', coordinates: [[127.6, 26.2], [127.65, 26.25], [127.7, 26.3]] } },
  ] })))
  expect((await routeOsmLocations(origin, destination, 'WALKING', undefined, true)).geometry)
    .toEqual([[origin, { latitude: 26.25, longitude: 127.65 }, destination]])
})

it('rejects missing road geometry rather than drawing a straight substitute', async () => {
  request.mockResolvedValue(new Response(JSON.stringify({ duration: 80, distance: 900 })))
  await expect(routeOsmLocations(origin, destination, 'DRIVING', undefined, true)).rejects.toThrow('缺少道路軌跡')
})

const unshortened = {
  approximate: false, full_link: 'https://www.google.com/maps?q=26.2083403,127.65044104999998',
  lat: 26.2083403, long: 127.65044104999998, name: '那霸機場150 Kagamizu',
  nominatim: false, searched: false, steps: 3, timestamp: 1792825663,
}
it.each([
  'https://maps.app.goo.gl/tWvNV7FfEfHbpd5X6',
  'https://goo.gl/maps/short-link',
  'maps.app.goo.gl/tWvNV7FfEfHbpd5X6',
])('sends every Maps short URL directly to Mapu and adapts its response: %s', async url => {
  request.mockResolvedValue(new Response(JSON.stringify(unshortened)))
  const [candidate] = await searchOsmLocations(url)
  const normalized = url.startsWith('https://') ? url : 'https://' + url
  expect(request).toHaveBeenCalledTimes(1)
  expect(request).toHaveBeenCalledWith('https://mapu.retiolus.net/unshortener?' + new URLSearchParams({ link: normalized }),
    expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer' }))
  expect(candidate).toMatchObject({ name: unshortened.name, mapsUrl: unshortened.full_link,
    location: { source: 'user', kind: 'user-picked', coordinate: { latitude: unshortened.lat, longitude: unshortened.long } } })
})
it('retains an approximate result warning rather than presenting it as an exact pin', async () => {
  request.mockResolvedValue(new Response(JSON.stringify({ ...unshortened, approximate: true })))
  const [candidate] = await searchOsmLocations('https://maps.app.goo.gl/test')
  expect(candidate.location.kind).toBe('approximate-center')
  expect(candidate.warning).toContain('推估')
})
it.each([
  { ...unshortened, long: '127.6' },
  { ...unshortened, lat: null },
  { ...unshortened, lat: 100 },
  { ...unshortened, approximate: undefined },
  { ...unshortened, full_link: 'https://evil.test/maps' },
])('rejects invalid Mapu fields or unsafe result links', async data => {
  request.mockResolvedValue(new Response(JSON.stringify(data)))
  await expect(searchOsmLocations('https://maps.app.goo.gl/test')).rejects.toThrow()
  expect(request).toHaveBeenCalledTimes(1)
})
it('reports external service errors without falling back to another parser', async () => {
  request.mockResolvedValueOnce(new Response('{}', { status: 429 }))
  await expect(searchOsmLocations('https://maps.app.goo.gl/test')).rejects.toThrow('請求過多')
  request.mockResolvedValueOnce(new Response('{}', { status: 503 }))
  await expect(searchOsmLocations('https://maps.app.goo.gl/test')).rejects.toThrow('HTTP 503')
  request.mockResolvedValueOnce(new Response('<html>error</html>'))
  await expect(searchOsmLocations('https://maps.app.goo.gl/test')).rejects.toThrow('有效 JSON')
  expect(request).toHaveBeenCalledTimes(3)
})
it('preserves coverage checks for Mapu coordinates', async () => {
  request.mockResolvedValue(new Response(JSON.stringify({ ...unshortened, lat: 25.03, long: 121.56 })))
  await expect(searchOsmLocations('https://maps.app.goo.gl/test')).rejects.toThrow('範圍')
})

it.each(['https://google.com.evil.test/maps', 'https://user@www.google.com/maps', 'https://goo.gl/not-maps'])('rejects invalid Maps input before sending it to Mapu: %s', async url => {
  await expect(searchOsmLocations(url)).rejects.toThrow('有效的 Google Maps 網址')
  expect(request).not.toHaveBeenCalled()
})

it('serializes route requests across travel modes and continues after a failed request', async () => {
  let rejectFirst!: (error: Error) => void
  request.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject }))
  request.mockResolvedValueOnce(new Response(JSON.stringify({ duration: 300, distance: 400 })))
  const first = routeOsmLocations(origin, destination, 'DRIVING')
  const failed = expect(first).rejects.toThrow('connection lost')
  const walking = routeOsmLocations(origin, destination, 'WALKING')
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
  rejectFirst(new Error('connection lost'))
  await failed
  expect(await walking).toEqual({ durationMinutes: 5, distanceMeters: 400 })
  expect(request).toHaveBeenCalledTimes(2)
  expect(JSON.parse(request.mock.calls[1][1].body).mode).toBe('walk')
})

it.each([
  { duration: 0, distance: 0 },
  { duration: 0, distance: 400 },
  { duration: 320, distance: 0 },
])('rejects zero routes for distinct endpoints rather than saving an invalid estimate: %j', async estimate => {
  request.mockResolvedValue(new Response(JSON.stringify(estimate)))
  await expect(routeOsmLocations(origin, destination, 'WALKING')).rejects.toThrow('非零路線')
})
