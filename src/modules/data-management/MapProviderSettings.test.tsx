import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ provider: 'google', error: '' }))
vi.mock('../../geo/provider-preference', () => ({
  useMapProvider: () => ({ provider: state.provider || undefined, error: state.error || undefined }),
  setMapProvider: vi.fn(),
}))
import { MapProviderSettings } from './MapProviderSettings'

beforeEach(() => { state.provider = 'google'; state.error = '' })

it('uses the designed provider card, select and illustration without loading any real map', () => {
  const html = renderToStaticMarkup(<MapProviderSettings />)
  expect(html).toContain('地圖設定')
  expect(html).toContain('地圖供應商')
  expect(html).toContain('<option value="google" selected="">Google Maps</option>')
  expect(html).toContain('此處為介面風格示意')
  expect(html).toContain('目前套用於正式行程地圖')
  expect(html).toContain('OSM 位置寫入目前限單機模式')
  expect(html).not.toContain('<iframe')
  expect(html).not.toContain('<script')
})

it('renders the OSM design with the persisted option selected', () => {
  state.provider = 'osm'
  const html = renderToStaticMarkup(<MapProviderSettings />)
  expect(html).toContain('<option value="osm" selected="">OpenStreetMap (OSM)</option>')
  expect(html).toContain('map-illustration-osm')
  expect(html).toContain('OSM 風格示意')
})

it('surfaces preference-read failures without presenting a successful Google fallback', () => {
  state.provider = ''
  state.error = 'storage denied'
  const html = renderToStaticMarkup(<MapProviderSettings />)
  expect(html).toContain('role="alert">storage denied')
  expect(html).toContain('請重新選擇')
  expect(html).not.toContain('<option value="google" selected="">')
})
