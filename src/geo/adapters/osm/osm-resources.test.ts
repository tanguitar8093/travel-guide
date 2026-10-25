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
  await expect(createOsmStyle('')).rejects.toThrow('osm:setup')
})

it('rejects an index missing the independent coastline layer', async () => {
  fetchTiles.mockResolvedValue({ ok: true, json: async () => ({ ...tilejson, vector_layers: [{ id: 'land' }] }) })
  await expect(createOsmStyle('')).rejects.toThrow('索引格式')
})

it('rejects unsupported tile URL protocols', async () => {
  fetchTiles.mockResolvedValue({ ok: true, json: async () => ({ ...tilejson, tiles: ['file:///tmp/tile.pbf'] }) })
  await expect(createOsmStyle('')).rejects.toThrow('HTTP')
})


it('loads Taiwan tile indexes and versioned tiles from the selected dataset', async () => {
  fetchTiles.mockResolvedValue({ok:true,json:async()=>({...tilejson,tiles:['/datasets/taiwan/tiles/version/{z}/{x}/{y}.pbf']})})
  const style=await createOsmStyle('/local-map','taiwan')
  expect(String(fetchTiles.mock.calls[0][0])).toBe('https://travel.example.test/local-map/datasets/taiwan/tiles.json')
  expect(style.sources.basemap.tiles[0]).toBe('https://travel.example.test/local-map/datasets/taiwan/tiles/version/{z}/{x}/{y}.pbf')
})

it('enables Okinawa zoom labels only when the tile index advertises their data', async () => {
  const withLabels = { ...tilejson, vector_layers: [...tilejson.vector_layers, { id: 'road_labels' }, { id: 'place_labels' }] }
  fetchTiles.mockResolvedValue({ ok: true, json: async () => withLabels })
  const style = await createOsmStyle('')
  expect(style.layers.find(layer => layer.id === 'road-labels-main')).toMatchObject({ minzoom: 12 })
  expect(style.layers.find(layer => layer.id === 'road-labels-local')).toMatchObject({ minzoom: 15 })
  expect(style.layers.find(layer => layer.id === 'place-labels')).toBeDefined()
})

it('keeps older Okinawa tiles usable without requesting absent label layers', async () => {
  const style = await createOsmStyle('')
  expect(style.layers.some(layer => layer.type === 'symbol')).toBe(false)
})

it('uses traditional Chinese road labels for Taiwan with the same zoom thresholds', async () => {
  fetchTiles.mockResolvedValue({ ok: true, json: async () => ({
    ...tilejson, vector_layers: [...tilejson.vector_layers, { id: 'road_labels' }, { id: 'place_labels' }],
  }) })
  const style = await createOsmStyle('', 'taiwan')
  expect(style.layers.find(layer => layer.id === 'road-labels-main')).toMatchObject({
    minzoom: 12, layout: { 'text-field': ['coalesce', ['get', 'name:zh-Hant'], ['get', 'name:zh'], ['get', 'name'], ['get', 'ref']] },
  })
  expect(style.layers.find(layer => layer.id === 'road-labels-local')).toMatchObject({ minzoom: 15 })
})

it('keeps older Taiwan tiles usable without absent label layers', async () => {
  expect((await createOsmStyle('', 'taiwan')).layers.some(layer => layer.type === 'symbol')).toBe(false)
})

it('enables Japanese road names at the same zoom thresholds for Japan', async () => {
  fetchTiles.mockResolvedValue({ ok: true, json: async () => ({
    ...tilejson, vector_layers: [...tilejson.vector_layers, { id: 'road_labels' }, { id: 'place_labels' }],
  }) })
  const style = await createOsmStyle('', 'japan')
  expect(style.layers.find(layer => layer.id === 'road-labels-main')).toMatchObject({
    minzoom: 12, layout: { 'text-field': ['coalesce', ['get', 'name:ja'], ['get', 'name'], ['get', 'ref']] },
  })
  expect(style.layers.find(layer => layer.id === 'road-labels-local')).toMatchObject({ minzoom: 15 })
})

it('keeps older Japan tiles usable without absent label layers', async () => {
  expect((await createOsmStyle('', 'japan')).layers.some(layer => layer.type === 'symbol')).toBe(false)
})
