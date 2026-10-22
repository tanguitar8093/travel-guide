import type { Coordinate, OsmPlaceReference, StoredLocation } from './contracts'
import { validateCoordinatePair, validateStoredLocation } from '../database/location.validation'
import { throwIfAborted } from './errors'
import './osm-search.css'

export interface OsmLocationCandidate {
  id: string
  name: string
  address?: string
  mapsUrl?: string
  warning?: string
  location: StoredLocation
}

export function suggestedOsmLocationName(candidate: OsmLocationCandidate): string {
  if (candidate.location.source === 'osm') return candidate.name
  const { latitude, longitude } = candidate.location.coordinate
  return candidate.mapsUrl && candidate.name !== `${latitude}, ${longitude}` ? candidate.name : ''
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function serviceBase(): string {
  const configured = import.meta.env.VITE_OSM_SERVICE_URL?.trim()
  if (configured) {
    const url = new URL(configured, window.location.origin)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('OSM 服務必須是沒有帳密的 HTTP/S 網址。')
    }
    return url.href.replace(/\/$/, '')
  }
  if (import.meta.env.DEV) return '/local-map'
  throw new Error('尚未設定 OSM 搜尋／路線服務 VITE_OSM_SERVICE_URL，不會改用 Google。')
}

async function request(path: string, signal?: AbortSignal, payload?: object): Promise<unknown> {
  throwIfAborted(signal)
  const timeout = AbortSignal.timeout(30000)
  const response = await fetch(serviceBase() + path, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    ...(payload ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : {}),
  })
  let data: unknown
  try { data = await response.json() } catch {
    throw new Error(`OSM 服務未回傳有效 JSON（HTTP ${response.status}）。`)
  }
  if (!response.ok) {
    throw new Error(record(data) && typeof data.error === 'string' ? data.error : `OSM 服務失敗（HTTP ${response.status}）。`)
  }
  return data
}

export function googleMapsNavigationUrl(coordinate: Coordinate): string {
  validateCoordinatePair(coordinate.latitude, coordinate.longitude)
  return `https://www.google.com/maps/dir/?api=1&destination=${coordinate.latitude},${coordinate.longitude}`
}

export async function searchOsmLocations(query: string, signal?: AbortSignal): Promise<OsmLocationCandidate[]> {
  throwIfAborted(signal)
  const text = query.trim()
  if (!text) return []
  if (text.length > 500) throw new Error('搜尋內容過長。')
  const coordinate = /^([+-]?\d+(?:\.\d+)?)\s*[,，]\s*([+-]?\d+(?:\.\d+)?)$/.exec(text)
  if (coordinate) {
    const latitude = Number(coordinate[1]), longitude = Number(coordinate[2])
    validateCoordinatePair(latitude, longitude)
    return [{
      id: `coordinate:${latitude},${longitude}`, name: `${latitude}, ${longitude}`,
      location: { source: 'user', kind: 'user-picked', coordinate: { latitude, longitude } },
    }]
  }
  if (/^(?:https?:\/\/|(?:www\.)?(?:maps\.)?google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl(?:\/maps)?\b)/i.test(text)) {
    const data = await request('/api/parse-map-url', signal, { url: text })
    if (!record(data) || typeof data.lat !== 'number' || typeof data.lng !== 'number' ||
        typeof data.inBounds !== 'boolean' || typeof data.resolved_url !== 'string') {
      throw new Error('Google Maps 網址解析結果格式不正確。')
    }
    validateCoordinatePair(data.lat, data.lng)
    let resolvedUrl: URL
    try {
      resolvedUrl = new URL(data.resolved_url)
    } catch {
      throw new Error('Google Maps 網址解析結果格式不正確。')
    }
    const allowedHosts = new Set([
      'maps.app.goo.gl', 'goo.gl', 'google.com', 'www.google.com', 'maps.google.com',
      'google.co.jp', 'www.google.co.jp', 'maps.google.co.jp',
      'google.com.tw', 'www.google.com.tw', 'maps.google.com.tw',
    ])
    if (!['http:', 'https:'].includes(resolvedUrl.protocol) ||
        resolvedUrl.username || resolvedUrl.password || !allowedHosts.has(resolvedUrl.hostname.toLowerCase())) {
      throw new Error('Google Maps 網址解析結果格式不正確。')
    }
    if (data.locationKind !== undefined &&
        !['pin', 'query-coordinate', 'map-center', 'url-coordinate'].includes(String(data.locationKind))) {
      throw new Error('Google Maps 網址解析結果格式不正確。')
    }
    if (!data.inBounds) {
      throw new Error(typeof data.warning === 'string' ? data.warning : '此位置超出目前 OSM 圖資範圍。')
    }
    const kind = data.locationKind === 'map-center' ? 'map-center' : 'user-picked'
    const name = typeof data.name === 'string' ? data.name.trim() : ''
    return [{
      id: `google-url:${data.lat},${data.lng}`,
      name: name || `${data.lat}, ${data.lng}`,
      mapsUrl: resolvedUrl.href,
      ...(kind === 'map-center' ? { warning: '這是 Google 地圖視窗中心，不一定是地點入口，請確認。' } : {}),
      location: { source: 'user', kind, coordinate: { latitude: data.lat, longitude: data.lng } },
    }]
  }
  if (/^[+-]?\d+[.,\d\s，+-]*$/.test(text)) throw new Error('請輸入「緯度, 經度」，例如 26.2170, 127.7195。')
  const data = await request('/api/search?q=' + encodeURIComponent(text), signal)
  if (!record(data) || !Array.isArray(data.results)) throw new Error('OSM 搜尋資料格式不正確。')
  return data.results.map((item: unknown): OsmLocationCandidate => {
    if (!record(item) || typeof item.id !== 'string' || typeof item.name !== 'string' || !item.name.trim() ||
        !Array.isArray(item.coordinates) || item.coordinates.length !== 2) throw new Error('OSM 搜尋結果缺少合法的名稱／位置。')
    const match = /^(?:osm-)?(node|way|relation)[/-]([1-9]\d*)$/.exec(item.id)
    if (!match) throw new Error('OSM 搜尋結果缺少完整的物件類型與識別碼。')
    const reference: OsmPlaceReference = { provider: 'osm', id: `${match[1] as 'node' | 'way' | 'relation'}/${match[2]}` }
    const location: StoredLocation = {
      source: 'osm', kind: reference.id.startsWith('node/') ? 'point' : 'approximate-center',
      reference,
      coordinate: { latitude: item.coordinates[1], longitude: item.coordinates[0] },
      ...(typeof data.dataTimestamp === 'string' && data.dataTimestamp.trim() ? { datasetVersion: data.dataTimestamp } : {}),
    }
    validateStoredLocation(location)
    return { id: reference.id, name: item.name, location, ...(typeof item.address === 'string' ? { address: item.address } : {}) }
  })
}

export async function routeOsmLocations(
  origin: Coordinate, destination: Coordinate, transport: string, signal?: AbortSignal,
): Promise<{ durationMinutes: number; distanceMeters: number }> {
  validateCoordinatePair(origin.latitude, origin.longitude)
  validateCoordinatePair(destination.latitude, destination.longitude)
  const mode = transport === 'DRIVING' ? 'car' : transport === 'WALKING' ? 'walk' : transport === 'BICYCLING' ? 'bike' : undefined
  if (!mode) throw new Error('OSM 靜態路線僅支援開車、步行或單車；不會改用 Google。')
  if (origin.latitude === destination.latitude && origin.longitude === destination.longitude) throw new Error('起點與終點相同，請選擇不同的位置。')
  const data = await request('/api/route', signal, {
    points: [[origin.longitude, origin.latitude], [destination.longitude, destination.latitude]], mode,
  })
  if (!record(data) || typeof data.duration !== 'number' || !Number.isFinite(data.duration) || data.duration < 0 ||
      typeof data.distance !== 'number' || !Number.isFinite(data.distance) || data.distance < 0) {
    throw new Error('OSM 路線回應沒有合法的時間與距離。')
  }
  return { durationMinutes: Math.ceil(data.duration / 60), distanceMeters: Math.round(data.distance) }
}

export async function mountOsmAutocomplete(
  container: HTMLElement,
  onSelect: (candidate: OsmLocationCandidate, query: string) => void,
  onError: (error: Error) => void,
  options: { label?: string; onInput?: () => void } = {},
): Promise<() => void> {
  const input = document.createElement('input')
  const results = document.createElement('div')
  const status = document.createElement('p')
  input.type = 'search'
  input.placeholder = '地點名稱或緯度, 經度'
  input.setAttribute('aria-label', options.label ?? '搜尋 OSM 地點')
  input.autocomplete = 'off'
  status.setAttribute('role', 'status')
  container.classList.add('osm-location-search')
  container.append(input, status, results)
  let active = true
  let revision = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: AbortController | undefined
  const search = async (current: number) => {
    const query = input.value.trim()
    if (!query) { status.textContent = ''; return }
    abort = new AbortController()
    status.textContent = '正在搜尋 OSM…'
    try {
      const candidates = await searchOsmLocations(query, abort.signal)
      if (!active || current !== revision) return
      status.textContent = candidates.length ? `找到 ${candidates.length} 個位置，請選取結果。` : '找不到符合的地點。'
      for (const candidate of candidates) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'osm-location-result'
        button.textContent = candidate.name
        if (candidate.address) {
          const note = document.createElement('small')
          note.textContent = candidate.address
          button.append(note)
        }
        button.onclick = () => {
          if (!active || current !== revision) return
          onSelect(candidate, query)
          status.textContent = `已選擇 ${candidate.name}`
          results.replaceChildren()
        }
        results.append(button)
      }
    } catch (cause) {
      if (active && current === revision) {
        status.textContent = '搜尋失敗。'
        onError(cause instanceof Error ? cause : new Error('OSM 搜尋失敗。'))
      }
    }
  }
  input.oninput = () => {
    const current = ++revision
    clearTimeout(timer)
    abort?.abort()
    results.replaceChildren()
    status.textContent = ''
    options.onInput?.()
    timer = setTimeout(() => void search(current), 300)
  }
  input.onkeydown = event => {
    if (event.key === 'Enter') {
      event.preventDefault()
      clearTimeout(timer)
      abort?.abort()
      results.replaceChildren()
      void search(++revision)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      results.querySelector<HTMLButtonElement>('button')?.focus()
    }
  }
  return () => {
    active = false
    ++revision
    clearTimeout(timer)
    abort?.abort()
    input.oninput = null
    input.onkeydown = null
    input.remove()
    status.remove()
    results.remove()
    container.classList.remove('osm-location-search')
  }
}
