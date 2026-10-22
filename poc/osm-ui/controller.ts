import type { RouteCalculationInput, RouteEndpoint, RouteMapPlace, TripMapData } from '../../src/modules/route-calculator/route-calculator.service'
import type { RouteMap, RouteMapChanges, Place, Trip } from '../../src/database/models'
import type { GooglePlaceDetails } from '../../src/modules/place/google-places.service'
import { EntityNotFoundError } from './errors'

// Preview IDs inhabit the old UI contract in memory only, never production DB.
const fixtures = [
  { id: 'preview-airport', name: '那霸機場', position: { lat: 26.1958, lng: 127.6459 }, address: '那霸市', date: '2026-11-07' },
  { id: 'preview-senaga', name: '瀨長島 Umikaji Terrace', position: { lat: 26.1767, lng: 127.6415 }, address: '豐見城市', date: '2026-11-07' },
  { id: 'preview-market', name: '第一牧志公設市場', position: { lat: 26.2147, lng: 127.6868 }, address: '那霸市松尾', date: '2026-11-07' },
  { id: 'preview-aquarium', name: '沖繩美麗海水族館', position: { lat: 26.6944, lng: 127.8779 }, address: '本部町', date: '2026-11-08' },
]
export const trip: Trip = { id: 'preview-trip', regionId: 'preview-okinawa', name: '沖繩行程（預覽範例）', startDate: '2026-11-07', endDate: '2026-11-08' }
export const savedPlaces: Place[] = fixtures.map(p => ({ id: p.id, name: p.name, googlePlaceId: p.id, regionIds: [trip.regionId], labelIds: [], mapsUrl: `https://www.openstreetmap.org/?mlat=${p.position.lat}&mlon=${p.position.lng}#map=16/${p.position.lat}/${p.position.lng}` }))
export const candidates = new Map<string, GooglePlaceDetails>(fixtures.map(p => [p.id, { id: p.id, displayName: p.name, formattedAddress: p.address, location: p.position, googleMapsUri: savedPlaces.find(row => row.id === p.id)?.mapsUrl }]))
let record: RouteMap = { id: 'preview-route-map', name: '沖繩路程試算', tripId: trip.id, transport: 'DRIVING', selectedDate: '2026-11-07', originGooglePlaceId: fixtures[0].id, destinationGooglePlaceId: fixtures[1].id }
const personal = new Set<string>()

async function request(url: string, payload?: object): Promise<unknown> {
  const response = await fetch('/local-map' + url, {
    ...(payload ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : {}),
    signal: AbortSignal.timeout(30000),
  })
  let data: unknown
  try { data = await response.json() } catch { throw new Error('OSM 服務未回傳有效資料，請確認 maps 服務。') }
  if (!response.ok) throw new Error(typeof data === 'object' && data && 'error' in data ? String(data.error) : 'OSM 服務不可用。')
  return data
}
function validPosition(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90
}

export class RouteCalculatorController {
  async listPlaces() { return savedPlaces }
  async listTrips() { return [trip] }
  async getInitialRouteMap() { return { ...record } }
  async getRouteMap(id: string) { if (id !== record.id) throw new EntityNotFoundError('預覽地圖不存在'); return { ...record } }
  async getOrCreateRouteMap(tripId?: string) { record = { ...record, tripId }; return { ...record } }
  async updateRouteMap(_id: string, changes: RouteMapChanges) { record = { ...record, ...changes } }
  async loadRouteMap(id: string) { const map = await this.getRouteMap(id); return { map, markers: await Promise.all([...personal].map(id => this.resolveEndpoint({ source: 'google', place: { id } }))), unavailable: [] } }
  async addRouteMapPlace(_mapId: string, id: string) { personal.add(id) }
  async removeRouteMapPlace(_mapId: string, id: string) { personal.delete(id) }
  async loadTripMarkers(_tripId: string): Promise<TripMapData> {
    return { dates: ['2026-11-07', '2026-11-08'], markers: fixtures.map(p => ({ googlePlaceId: p.id, name: p.name, position: p.position, address: p.address, dates: [p.date] })), unavailable: [] }
  }
  async resolveEndpoint(endpoint: RouteEndpoint): Promise<RouteMapPlace> {
    const id = endpoint.source === 'saved' ? endpoint.placeId : endpoint.place.id
    const detail = endpoint.source === 'google' && endpoint.place.location ? endpoint.place : candidates.get(id)
    if (!detail?.location) throw new Error('此預覽地點沒有可用的座標。')
    candidates.set(id, detail)
    return { googlePlaceId: id, name: detail.displayName || detail.formattedAddress || 'OSM 地點', position: detail.location, address: detail.formattedAddress }
  }
  isGooglePlacesConfigured() { return true }
  async calculate(input: RouteCalculationInput) {
    const mode = ({ DRIVING: 'car', WALKING: 'walk', BICYCLING: 'bike' } as Record<string, string>)[input.transport]
    if (!mode) throw new Error('目前 OSM 服務不支援此交通方式，請選擇開車、步行或單車。')
    const [origin, destination] = await Promise.all([this.resolveEndpoint(input.origin), this.resolveEndpoint(input.destination)])
    if (origin.googlePlaceId === destination.googlePlaceId) throw new Error('起點與終點相同，請選擇不同的地點。')
    const data = await request('/api/route', { points: [origin, destination].map(p => [p.position.lng, p.position.lat]), mode })
    if (!data || typeof data !== 'object' || !('duration' in data) || !('distance' in data) || typeof data.duration !== 'number' || typeof data.distance !== 'number' || !Number.isFinite(data.duration) || !Number.isFinite(data.distance) || data.duration < 0 || data.distance < 0) throw new Error('OSM 路程資料格式不正確。')
    return { origin, destination, transport: input.transport, durationMinutes: Math.ceil(data.duration / 60), distanceMeters: Math.round(data.distance) }
  }
  async mountAutocomplete(container: HTMLElement, onSelect: (details: GooglePlaceDetails, query: string) => void, onError: (error: Error) => void, options: { label?: string; onInput?: () => void } = {}) {
    const input = document.createElement('input'), results = document.createElement('div')
    input.type = 'search'; input.placeholder = '輸入地址、店名或景點名稱'; input.setAttribute('aria-label', options.label || '搜尋 OSM 地點')
    container.append(input, results)
    let active = true, generation = 0, timer: ReturnType<typeof setTimeout>
    const search = async () => {
      const current = ++generation, query = input.value.trim()
      results.replaceChildren(); if (!query) return
      try {
        const data = await request('/api/search?q=' + encodeURIComponent(query))
        if (!active || current !== generation) return
        if (!data || typeof data !== 'object' || !('results' in data) || !Array.isArray(data.results)) throw new Error('OSM 搜尋資料格式不正確。')
        if (!data.results.length) results.textContent = '找不到符合的地點。'
        for (const item of data.results) {
          if (!item || typeof item !== 'object' || typeof item.id !== 'string' || typeof item.name !== 'string' || !validPosition(item.coordinates)) continue
          const detail = { id: item.id, displayName: item.name, formattedAddress: typeof item.address === 'string' ? item.address : undefined, location: { lng: item.coordinates[0], lat: item.coordinates[1] }, googleMapsUri: `https://www.openstreetmap.org/?mlat=${item.coordinates[1]}&mlon=${item.coordinates[0]}#map=16/${item.coordinates[1]}/${item.coordinates[0]}` }
          const button = document.createElement('button'); button.type = 'button'; button.className = 'route-secondary'; button.style.cssText = 'width:100%;justify-content:flex-start;margin-top:6px;text-align:left;'; button.textContent = detail.displayName
          button.onclick = () => { candidates.set(detail.id, detail); onSelect(detail, query) }; results.append(button)
        }
      } catch (cause) { if (active && current === generation) onError(cause instanceof Error ? cause : new Error('OSM 搜尋失敗。')) }
    }
    input.oninput = () => { ++generation; options.onInput?.(); clearTimeout(timer); timer = setTimeout(search, 300) }
    input.focus()
    return () => { active = false; ++generation; clearTimeout(timer); container.replaceChildren() }
  }
}
