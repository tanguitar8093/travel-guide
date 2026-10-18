import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { startLayoutDebug } from './layout-debug'

let browser: EventTarget & {
  innerWidth: number
  innerHeight: number
  alert: ReturnType<typeof vi.fn>
}
let visualViewport: EventTarget & { width: number; height: number; scale: number }
let root: { clientWidth: number; clientHeight: number; scrollWidth: number; scrollHeight: number }
let queries: Map<string, EventTarget & { readonly matches: boolean }>
let meta: string[]

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  root = { clientWidth: 980, clientHeight: 1945, scrollWidth: 980, scrollHeight: 1945 }
  visualViewport = Object.assign(new EventTarget(), { width: 980, height: 1945, scale: 0.35 })
  queries = new Map()
  meta = ['width=device-width, initial-scale=1.0']
  browser = Object.assign(new EventTarget(), {
    innerWidth: 980,
    innerHeight: 1945,
    screen: { width: 344, height: 765 },
    visualViewport,
    devicePixelRatio: 3.25,
    location: { origin: 'https://example.test', pathname: '/itinerary' },
    navigator: { userAgent: 'test-browser' },
    alert: vi.fn(),
    setTimeout,
    clearTimeout,
    matchMedia: (query: string) => {
      let result = queries.get(query)
      if (!result) {
        result = new class extends EventTarget {
          get matches() {
            const width = query.match(/max-width: (\d+)px/)
            return width ? root.clientWidth <= Number(width[1]) : query === '(orientation: portrait)'
          }
        }()
        queries.set(query, result)
      }
      return result
    },
  })
  vi.stubGlobal('window', browser)
  vi.stubGlobal('document', Object.assign(new EventTarget(), {
    documentElement: root,
    visibilityState: 'visible',
    querySelectorAll: () => meta.map((content) => ({ getAttribute: () => content })),
  }))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function start() {
  return startLayoutDebug({ mobile: 680, compact: 1000 }, '行程')
}

it('records actual initial, 2-second and 5-second widths before opening one dialog', () => {
  start()
  vi.advanceTimersByTime(1000)
  root.clientWidth = browser.innerWidth = visualViewport.width = 344
  visualViewport.scale = 1
  browser.dispatchEvent(new Event('resize'))
  queries.get('(max-width: 680px)')?.dispatchEvent(new Event('change'))
  vi.advanceTimersByTime(1000)
  expect(browser.alert).not.toHaveBeenCalled()
  vi.advanceTimersByTime(2999)
  expect(browser.alert).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(browser.alert).toHaveBeenCalledTimes(1)
  const report = browser.alert.mock.calls[0][0]
  expect(report).toContain('[0 秒／開始觀察]')
  expect(report).toContain('inner 980×1945')
  expect(report).toContain('[1 秒／window.resize]')
  expect(report).toContain('[1 秒／mediaQuery.change]')
  expect(report).toContain('[2 秒／2 秒取樣]')
  expect(report).toContain('[5 秒／5 秒取樣]')
  expect(report).toContain('inner 344×1945')
  expect(report).toContain('內容 手機版')
  expect(report).toContain('初始 viewport meta：width=device-width, initial-scale=1.0')
})

it('reports a persistent 980px viewport without changing the page', () => {
  start()
  vi.advanceTimersByTime(5000)
  const report = browser.alert.mock.calls[0][0]
  expect(report.match(/inner 980×1945/g)).toHaveLength(3)
  expect(report.match(/側欄 電腦版；內容 中寬版/g)).toHaveLength(3)
  expect(browser.innerWidth).toBe(980)
  expect(visualViewport.scale).toBe(0.35)
})

it('cancels pending samples and removes listeners when disabled or unmounted', () => {
  const stop = start()
  const removeWindow = vi.spyOn(browser, 'removeEventListener')
  const removeViewport = vi.spyOn(visualViewport, 'removeEventListener')
  const query = queries.get('(max-width: 680px)')
  if (!query) throw new Error('Expected the mobile media query to be registered')
  const removeQuery = vi.spyOn(query, 'removeEventListener')
  vi.advanceTimersByTime(1000)
  stop()
  vi.advanceTimersByTime(5000)
  expect(browser.alert).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
  expect(removeWindow).toHaveBeenCalledWith('resize', expect.any(Function))
  expect(removeViewport).toHaveBeenCalledWith('resize', expect.any(Function))
  expect(removeQuery).toHaveBeenCalledWith('change', expect.any(Function))
})

it('bounds event records while retaining scheduled samples and reporting missing viewport metadata', () => {
  meta = []
  start()
  for (let index = 0; index < 12; index += 1) {
    visualViewport.dispatchEvent(new Event('resize'))
  }
  vi.advanceTimersByTime(5000)
  const report = browser.alert.mock.calls[0][0]
  expect(report.match(/visualViewport.resize/g)).toHaveLength(8)
  expect(report).toContain('另有 4 筆變動事件')
  expect(report).toContain('[2 秒／2 秒取樣]')
  expect(report).toContain('[5 秒／5 秒取樣]')
  expect(report).toContain('(缺少 viewport 標籤)')
})
