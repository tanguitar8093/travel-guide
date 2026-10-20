import { createServer } from 'node:http'

try {
  process.loadEnvFile('.env.local')
} catch {
  console.error('[core-check:google] 找不到或無法讀取 .env.local。')
  process.exit(1)
}

const apiKey = process.env.VITE_GOOGLE_MAPS_API_KEY?.trim()

if (!apiKey) {
  console.error('[core-check:google] .env.local 需要設定 VITE_GOOGLE_MAPS_API_KEY。')
  process.exit(1)
}

let chromium
try {
  chromium = (await import('@playwright/test')).chromium
} catch {
  console.error('[core-check:google] 找不到 Playwright 套件，請先安裝專案依賴。')
  process.exit(1)
}

const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end('<!doctype html><html><head></head><body></body></html>')
})
let browser
try {
  let listenError
  const configuredPort = await new Promise((resolve, reject) => {
    server.once('error', (error) => {
      listenError = error
      reject(error)
    })
    server.listen(5173, '127.0.0.1', () => resolve(5173))
  }).catch(async () => {
    if (listenError?.code !== 'EADDRINUSE') throw listenError
    return new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve(server.address().port))
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Unable to determine local server address.')

  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  let apiError = false
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('Google Maps JavaScript API')) {
      apiError = true
    }
  })
  await page.goto(`http://127.0.0.1:${configuredPort}/`)
  await page.evaluate(() => {
    window.__travelGuideCoreCheckReady = () => undefined
  })
  const endpoint = new URL('https://maps.googleapis.com/maps/api/js')
  endpoint.searchParams.set('key', apiKey)
  endpoint.searchParams.set('loading', 'async')
  endpoint.searchParams.set('libraries', 'places')
  endpoint.searchParams.set('callback', '__travelGuideCoreCheckReady')
  await page.addScriptTag({ url: endpoint.toString() })
  await page.waitForFunction(() => typeof window.google?.maps?.importLibrary === 'function', null, { timeout: 15_000 })
  if (apiError) throw new Error('Google Maps API reported a configuration error.')
  const hasPlacesLibrary = await page.evaluate(async () => {
    const places = await window.google.maps.importLibrary('places')
    return typeof places.PlaceAutocompleteElement === 'function'
  })
  if (!hasPlacesLibrary || apiError) throw new Error('Places library did not load cleanly.')
  console.log('[core-check:google] Google Maps JavaScript API 連線正常。')
} catch {
  console.error('[core-check:google] API 載入、金鑰驗證或 Places Library 檢查失敗。')
  process.exit(1)
} finally {
  await browser?.close()
  if (server.listening) server.close()
}
