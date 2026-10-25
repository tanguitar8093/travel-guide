// Run against npm run dev after rebuilding tiles and restarting OSM.
// OSM_LABEL_DATASET=taiwan selects the Taiwan preview; Okinawa remains the default.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'
const base = process.env.OSM_CHECK_URL || 'http://127.0.0.1:5173'
const dataset = process.env.OSM_LABEL_DATASET || 'okinawa'
assert.ok(['okinawa', 'taiwan'].includes(dataset))
const output = process.env.OSM_LABEL_OUTPUT || `/tmp/travel-${dataset}-labels`
const baseline = process.env.OSM_LABEL_BASELINE_URL
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  if (baseline) await page.route(/\/local-map\/(?:datasets\/taiwan\/)?tiles/, async route => {
    const url = new URL(route.request().url())
    const response = await route.fetch({ url: `${baseline}${url.pathname.replace('/local-map', '')}` })
    await route.fulfill({ response })
  })
  const cdp = await page.context().newCDPSession(page)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto(`${base}/poc/osm-ui/zoom-labels.html?dataset=${dataset}`)
  await page.waitForFunction(() => window.labelPreview?.loaded(), { timeout: 60000 })
  const samples = []
  for (const zoom of [10, 13, 16]) {
    await page.getByRole('button', { name: new RegExp(zoom === 10 ? '遠景' : zoom === 13 ? '中景' : '近景') }).click()
    await page.waitForFunction(() => window.labelPreview?.loaded())
    if (!baseline) await page.waitForFunction(zoom => {
      const map = window.labelPreview
      const count = id => map.getLayer(id) && map.queryRenderedFeatures({ layers: [id] }).length
      return count('place-labels') > 0 && (zoom < 12 || count('road-labels-main') > 0)
        && (zoom < 15 || count('road-labels-local') > 0)
    }, zoom, { timeout: 30000 })
    // Allow symbol fade/collision placement to settle before counting visible labels.
    await page.waitForTimeout(700)
    const sample = await page.evaluate(() => {
      const map = window.labelPreview
      const counts = Object.fromEntries(['place-labels', 'road-labels-main', 'road-labels-local'].map(id => [id, map.getLayer(id) ? map.queryRenderedFeatures({ layers: [id] }).length : 0]))
      return { zoom: map.getZoom(), counts }
    })
    // Comparable post-GC page heap; excludes worker heaps, GPU and native allocations.
    await cdp.send('HeapProfiler.collectGarbage')
    sample.pageHeapMiB = (await cdp.send('Runtime.getHeapUsage')).usedSize / 1048576
    if (!baseline) {
    assert.ok(sample.counts['place-labels'] > 0, `Missing place labels at z${zoom}`)
    if (zoom === 10) assert.equal(sample.counts['road-labels-main'], 0)
    if (zoom < 15) assert.equal(sample.counts['road-labels-local'], 0)
    if (zoom >= 12) assert.ok(sample.counts['road-labels-main'] > 0)
    if (zoom >= 15) assert.ok(sample.counts['road-labels-local'] > 0)
    }
    samples.push(sample)
    await page.screenshot({ path: `${output}/zoom-${zoom}.png` })
  }
  if (!baseline) {
    const layerOrder = await page.evaluate(async dataset => {
      const previous = window.labelPreview
      const center = previous.getCenter()
      previous.remove()
      document.querySelector('header').remove()
      const { createOsmStyle, loadOsmMapLibre } = await import('/src/geo/adapters/osm/osm-resources.ts')
      const { createMapLibreRenderer } = await import('/src/geo/adapters/osm/maplibre-renderer.ts')
      const sdk = await loadOsmMapLibre('/local-map')
      let map
      const renderer = createMapLibreRenderer({
        style: await createOsmStyle('/local-map', dataset),
        loadSdk: async () => ({ ...sdk, Map: class extends sdk.Map {
          constructor(options) { super(options); map = this }
        } }),
      })
      const handle = await renderer.mount(document.querySelector('#map'), {
        center: { longitude: center.lng, latitude: center.lat }, zoom: 16,
      })
      const road = map.querySourceFeatures('basemap', { sourceLayer: 'road_labels' })
        .filter(feature => feature.geometry.type === 'LineString')
        .sort((a, b) => {
          const distance = feature => Math.min(...feature.geometry.coordinates.map(([lng, lat]) => (lng - center.lng) ** 2 + (lat - center.lat) ** 2))
          return distance(a) - distance(b)
        })[0]
      if (!road) throw new Error('Missing road geometry for itinerary overlay check')
      handle.setRoute([road.geometry.coordinates.map(([longitude, latitude]) => ({ longitude, latitude }))])
      window.labelPreview = map
      return map.getStyle().layers.map(layer => ({ id: layer.id, type: layer.type }))
    }, dataset)
    const routeIndex = layerOrder.findIndex(layer => layer.id === 'tripmap-itinerary-route')
    assert.ok(routeIndex > layerOrder.findIndex(layer => layer.id === 'main-roads'))
    assert.ok(layerOrder.filter(layer => layer.type === 'symbol').every(layer => layerOrder.findIndex(item => item.id === layer.id) > routeIndex))
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${output}/route-under-labels.png` })
  }
  assert.deepEqual(errors, [])
  await writeFile(`${output}/browser.json`, JSON.stringify({ samples, errors, baseline: Boolean(baseline) }, null, 2) + '\n')
  console.log(JSON.stringify({ samples, errors }, null, 2))
} finally {
  await browser.close()
}
