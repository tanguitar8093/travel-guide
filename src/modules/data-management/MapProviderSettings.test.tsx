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
  expect(html).toContain('請至「區域」頁面選擇沖繩或台灣')
  expect(html).toContain('混合模式先儲存於本機')
  expect(html).toContain('既有背景同步上傳位置與路線端點')
  expect(html).not.toContain('<iframe')
  expect(html).not.toContain('<script')
})

it('renders the OSM design with the persisted option selected', () => {
  state.provider = 'osm'
  const html = renderToStaticMarkup(<MapProviderSettings />)
  expect(html).toContain('<option value="osm" selected="">OpenStreetMap</option>')
  expect(html).toContain('map-illustration-osm')
  expect(html).toContain('OpenStreetMap 風格示意')
})

it('surfaces preference-read failures without presenting a successful Google fallback', () => {
  state.provider = ''
  state.error = 'storage denied'
  const html = renderToStaticMarkup(<MapProviderSettings />)
  expect(html).toContain('role="alert">storage denied')
  expect(html).toContain('請重新選擇')
  expect(html).not.toContain('<option value="google" selected="">')
})
