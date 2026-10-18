import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installResponsiveViewport, needsScreenViewport } from './responsive-viewport'

it.each([
  [344, 980, true, true],
  [698, 980, true, true],
  [344, 344, true, false],
  [698, 698, true, false],
  [344, 360, true, false],
  [344, 430, true, false],
  [344, 980, false, false],
  [1024, 1440, true, false],
  [0, 980, true, false],
])('checks screen %i, layout %i and touch %s before correcting', (screenWidth, layoutWidth, touch, expected) => {
  expect(needsScreenViewport({ screenWidth, layoutWidth, touch })).toBe(expected)
})

let browser: EventTarget & { screen: { width: number } }
let root: { clientWidth: number; dataset: { screenViewportWidth?: string } }
let meta: { content: string }
let touchQuery: EventTarget & { matches: boolean }
let viewport: EventTarget
let stop: (() => void) | undefined

beforeEach(() => {
  meta = { content: 'width=device-width, initial-scale=1.0' }
  root = { clientWidth: 980, dataset: {} }
  touchQuery = Object.assign(new EventTarget(), { matches: true })
  viewport = new EventTarget()
  browser = Object.assign(new EventTarget(), {
    screen: { width: 344 },
    matchMedia: () => touchQuery,
    visualViewport: viewport,
  })
  vi.stubGlobal('window', browser)
  vi.stubGlobal('document', { querySelector: () => meta, documentElement: root })
})

afterEach(() => {
  stop?.()
  stop = undefined
  vi.unstubAllGlobals()
})

it('requests the narrow screen width immediately and follows folding without reloading', () => {
  stop = installResponsiveViewport()
  expect(meta.content).toBe('width=344, initial-scale=1.0')
  expect(root.dataset.screenViewportWidth).toBe('344')
  root.clientWidth = 344
  browser.screen.width = 698
  browser.dispatchEvent(new Event('resize'))
  expect(meta.content).toBe('width=698, initial-scale=1.0')
  browser.screen.width = 344
  browser.dispatchEvent(new Event('resize'))
  expect(meta.content).toBe('width=344, initial-scale=1.0')
})

it('does not repeatedly rewrite viewport after applying a correction', () => {
  stop = installResponsiveViewport()
  meta.content = 'unchanged-by-resize'
  viewport.dispatchEvent(new Event('resize'))
  expect(meta.content).toBe('unchanged-by-resize')
})

it('keeps normal mobile viewports unchanged but detects a later mismatch', () => {
  root.clientWidth = 344
  stop = installResponsiveViewport()
  expect(meta.content).toBe('width=device-width, initial-scale=1.0')
  root.clientWidth = 980
  browser.dispatchEvent(new Event('pageshow'))
  expect(meta.content).toBe('width=344, initial-scale=1.0')
})

it('restores normal viewport configuration when leaving the small touch screen', () => {
  stop = installResponsiveViewport()
  browser.screen.width = 1024
  browser.dispatchEvent(new Event('resize'))
  expect(meta.content).toBe('width=device-width, initial-scale=1.0')
  expect(root.dataset.screenViewportWidth).toBeUndefined()
})

it('does not apply screen-based corrections to a non-touch desktop browser', () => {
  touchQuery.matches = false
  stop = installResponsiveViewport()
  expect(meta.content).toBe('width=device-width, initial-scale=1.0')
  expect(root.dataset.screenViewportWidth).toBeUndefined()
})

it('cleans up listeners and restores the original viewport', () => {
  stop = installResponsiveViewport()
  const remove = vi.spyOn(browser, 'removeEventListener')
  const removeViewport = vi.spyOn(viewport, 'removeEventListener')
  const removeQuery = vi.spyOn(touchQuery, 'removeEventListener')
  stop()
  expect(meta.content).toBe('width=device-width, initial-scale=1.0')
  expect(root.dataset.screenViewportWidth).toBeUndefined()
  expect(remove).toHaveBeenCalledWith('resize', expect.any(Function))
  expect(removeViewport).toHaveBeenCalledWith('resize', expect.any(Function))
  expect(removeQuery).toHaveBeenCalledWith('change', expect.any(Function))
})
