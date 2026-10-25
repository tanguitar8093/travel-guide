// Run against npm run dev after rebuilding Okinawa tiles and restarting OSM.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'
const base = process.env.OSM_CHECK_URL || 'http://127.0.0.1:5173'
const output = process.env.OSM_LABEL_OUTPUT || '/tmp/travel-okinawa-labels'
const baseline = process.env.OSM_LABEL_BASELINE_URL
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  if (baseline) await page.route('**/local-map/tiles*', async route => {
    const url = new URL(route.request().url())
    const response = await route.fetch({ url: `${baseline}${url.pathname.replace('/local-map', '')}` })
    await route.fulfill({ response })
  })
  const cdp = await page.context().newCDPSession(page)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto(`${base}/poc/osm-ui/zoom-labels.html`)
  await page.waitForFunction(() => window.labelPreview?.loaded(), { timeout: 60000 })
  const samples = []
  for (const zoom of [10, 13, 16]) {
    await page.getByRole('button', { name: new RegExp(zoom === 10 ? '遠景' : zoom === 13 ? '中景' : '近景') }).click()
    await page.waitForFunction(() => window.labelPreview?.loaded())
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
  assert.deepEqual(errors, [])
  await writeFile(`${output}/browser.json`, JSON.stringify({ samples, errors, baseline: Boolean(baseline) }, null, 2) + '\n')
  console.log(JSON.stringify({ samples, errors }, null, 2))
} finally {
  await browser.close()
}
