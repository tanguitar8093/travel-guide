import type { GooglePlaceDetails } from '../../src/modules/place/google-places.service'

export function googleNavigationUrl(position: { lat: number; lng: number }) {
  return `https://www.google.com/maps/dir/?api=1&destination=${position.lat},${position.lng}`
}
export function googleNameUrl(name: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`
}
export function isGoogleMapUrl(value: string) {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
      (/^(?:www\.|maps\.)?google\.(?:com|com\.tw|co\.jp)$/.test(url.hostname) && (url.pathname.startsWith('/maps') || url.hostname.startsWith('maps.')) || url.hostname === 'maps.app.goo.gl' || url.hostname === 'goo.gl' && url.pathname.startsWith('/maps/'))
  } catch { return false }
}
function coordinate(value: string) {
  const match = /^\s*([+-]?\d+(?:\.\d+)?)\s*[,，]\s*([+-]?\d+(?:\.\d+)?)\s*$/.exec(value)
  if (!match) return undefined
  const lat = Number(match[1]), lng = Number(match[2])
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error('經緯度超出範圍，請用「緯度, 經度」。')
  return { lat, lng }
}
function detail(position: { lat: number; lng: number }, name?: string, warning?: string): GooglePlaceDetails {
  return { id: `coordinate:${position.lat},${position.lng}`, displayName: name || `${position.lat}, ${position.lng}`, location: position, formattedAddress: warning, googleMapsUri: googleNavigationUrl(position) }
}
export async function resolveLocationInput(query: string, request: (url: string, payload?: object) => Promise<unknown>): Promise<GooglePlaceDetails[] | undefined> {
  const direct = coordinate(query)
  if (direct) return [detail(direct)]
  if (/^[+-]?\d+[.,\d\s，+-]*$/.test(query)) throw new Error('請用「緯度, 經度」，例如 26.2170, 127.7195。')
  if (!/^https?:\/\//i.test(query)) return undefined
  if (!isGoogleMapUrl(query)) throw new Error('請貼上 Google 地圖連結。')
  const url = new URL(query)
  // Explicit destination/query coordinates are locations; @lat,lng is only a map center.
  for (const key of ['destination', 'query', 'q']) {
    const position = coordinate(url.searchParams.get(key) || '')
    if (position) return [detail(position)]
  }
  const place = /!3d([+-]?\d+(?:\.\d+)?)!4d([+-]?\d+(?:\.\d+)?)/.exec(url.href)
  if (place) { const position = coordinate(`${place[1]},${place[2]}`); if (position) return [detail(position)] }
  const center = /@([+-]?\d+(?:\.\d+)?),([+-]?\d+(?:\.\d+)?)/.exec(url.href)
  if (center) { const position = coordinate(`${center[1]},${center[2]}`); if (position) return [detail(position, undefined, '地圖中心，請確認實際入口。')] }
  const data = await request('/api/parse-map-url', { url: query })
  if (!data || typeof data !== 'object' || !('lat' in data) || !('lng' in data) || typeof data.lat !== 'number' || typeof data.lng !== 'number') throw new Error('連結無法定位，請改貼完整連結或經緯度。')
  const position = coordinate(`${data.lat},${data.lng}`)
  if (!position) throw new Error('連結沒有有效的經緯度。')
  return [detail(position, 'name' in data && typeof data.name === 'string' ? data.name : undefined, 'locationKind' in data && data.locationKind === 'map-center' ? '地圖中心，請確認實際入口。' : undefined)]
}
