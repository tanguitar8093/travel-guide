import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createOsmStyle } from './osm-resources'

const tilejson = {
  tiles: ['/tiles/version/{z}/{x}/{y}.pbf'], minzoom: 5, maxzoom: 14,
  bounds: [127.58, 25.98, 128.36, 26.9],
  vector_layers: ['land', 'water', 'coastline', 'roads'].map(id => ({ id })),
}
const fetchTiles = vi.fn()
beforeEach(() => {
  vi.stubGlobal('window', { location: { origin: 'https://travel.example.test' } })
  vi.stubGlobal('fetch', fetchTiles)
  fetchTiles.mockReset().mockResolvedValue({ ok: true, json: async () => tilejson })
})
afterEach(() => vi.unstubAllGlobals())

it.each([
  ['', 'https://travel.example.test/local-map'],
  ['https://maps.example.test/maps', 'https://maps.example.test/maps'],
])('loads vector tiles from the service base %s without requesting whole GeoJSON', async (base, expected) => {
  const style = await createOsmStyle(base)
  expect(String(fetchTiles.mock.calls[0][0])).toBe(`${expected}/tiles.json`)
  expect(fetchTiles.mock.calls[0][1]).toMatchObject({ cache: 'no-cache' })
  expect(style.sources.basemap).toMatchObject({ type: 'vector', tiles: [`${expected}/tiles/version/{z}/{x}/{y}.pbf`], minzoom: 5, maxzoom: 14 })
  expect(style.layers.find(layer => layer.id === 'coast')).toMatchObject({ 'source-layer': 'coastline' })
  expect(JSON.stringify(style)).not.toContain('geojson')
})

it('fails clearly when tiles are absent, without falling back to large GeoJSON', async () => {
  fetchTiles.mockResolvedValue({ ok: false })
  await expect(createOsmStyle('')).rejects.toThrow('build:tiles')
})

it('rejects an index missing the independent coastline layer', async () => {
  fetchTiles.mockResolvedValue({ ok: true, json: async () => ({ ...tilejson, vector_layers: [{ id: 'land' }] }) })
  await expect(createOsmStyle('')).rejects.toThrow('索引格式')
})

it('rejects unsupported tile URL protocols', async () => {
  fetchTiles.mockResolvedValue({ ok: true, json: async () => ({ ...tilejson, tiles: ['file:///tmp/tile.pbf'] }) })
  await expect(createOsmStyle('')).rejects.toThrow('HTTP')
})
