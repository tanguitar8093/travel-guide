import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MapMarker, MapRenderer } from './contracts'
import { createGoogleRenderer } from './adapters/google/google-renderer'
import { createMapLibreRenderer } from './adapters/osm/maplibre-renderer'
import type { GoogleMapInstance, GoogleRendererSdk } from './adapters/google/google-sdk'
import { createGoogleSdkLoader } from './adapters/google/google-sdk'
import { markerBounds } from './map-validation'

class FakeElement extends EventTarget {
  className = ''
  textContent = ''
  querySelector = vi.fn(() => null)
  title = ''
  type = ''
  style = { backgroundColor: '' }
  classList = { add: vi.fn() }
  children: FakeElement[] = []
  attributes = new Map<string, string>()
  append(child: FakeElement) { this.children.push(child) }
  setAttribute(name: string, value: string) { this.attributes.set(name, value) }
  remove = vi.fn()
}

const removeObserver = vi.fn()
const center = { latitude: 26, longitude: 127 }
const points: readonly MapMarker[] = [
  { id: 'a', name: 'A', coordinate: center, sequence: 1 },
  { id: 'b', name: 'B', coordinate: { latitude: 27, longitude: 128 }, color: '#123456', selected: true },
]

beforeEach(() => {
  removeObserver.mockClear()
  vi.stubGlobal('document', { createElement: () => new FakeElement() })
  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn()
    disconnect = removeObserver
  })
})

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

function googleHarness(autoReady = true) {
  const fit = vi.fn()
  const focus = vi.fn()
  const zoom = vi.fn()
  const clear = vi.fn()
  const removeListener = vi.fn()
  const markerRecords: { map: GoogleMapInstance | null; content: HTMLElement }[] = []
  const sdk: GoogleRendererSdk = {
    Map: class {
      setCenter = focus
      setZoom = zoom
      fitBounds = fit
      addListener(_event: 'idle', listener: () => void) {
        if (autoReady) queueMicrotask(listener)
        return { remove: removeListener }
      }
    },
    AdvancedMarkerElement: class {
      map: GoogleMapInstance | null
      content: HTMLElement
      constructor(options: { map: GoogleMapInstance; content: HTMLElement }) {
        this.map = options.map
        this.content = options.content
        markerRecords.push(this)
      }
    },
    clearInstanceListeners: clear,
  }
  return { sdk, renderer: createGoogleRenderer(async () => sdk), fit, focus, zoom, clear, removeListener, markerRecords }
}

function osmHarness(autoReady = true) {
  const setData = vi.fn()
  const addLayer = vi.fn()
  const addSource = vi.fn()
  let sourceExists = false
  const fit = vi.fn()
  const focus = vi.fn()
  const remove = vi.fn()
  const markerRemove = vi.fn()
  const positions: [number, number][] = []
  const elements: HTMLElement[] = []
  const errors = new Set<(event: { error: Error }) => void>()
  const renderer = createMapLibreRenderer({
    style: { version: 8, sources: {}, layers: [] },
    loadSdk: async () => ({
      Map: class {
        loaded() { return autoReady }
        on(type: string, listener: (() => void) | ((event: { error: Error }) => void)) {
          if (type === 'error') errors.add(listener)
        }
        off(type: string, listener: (() => void) | ((event: { error: Error }) => void)) {
          if (type === 'error') errors.delete(listener)
        }
        getSource() { return sourceExists ? { setData } : undefined }
        addSource(...args: unknown[]) { sourceExists = true; addSource(...args) }
        addLayer = addLayer
        jumpTo = focus
        fitBounds = fit
        addControl = vi.fn()
        resize = vi.fn()
        remove = remove
      },
      Marker: class {
        constructor(options: { element: HTMLElement }) { elements.push(options.element) }
        setLngLat(position: [number, number]) { positions.push(position); return this }
        addTo() { return this }
        remove = markerRemove
      },
      NavigationControl: class {},
    }),
  })
  return { renderer, fit, focus, remove, markerRemove, positions, elements, errors, setData, addSource, addLayer }
}

describe.each(['google', 'osm'] as const)('%s renderer contract', provider => {
  function setup() {
    return provider === 'google' ? googleHarness() : osmHarness()
  }

  it('mounts, replaces markers without fitting, and emits project IDs', async () => {
    const harness = setup()
    const selected = vi.fn()
    const handle = await harness.renderer.mount(document.createElement('div'), {
      center, zoom: 10, events: { onSelect: selected },
    })
    handle.setMarkers(points)
    expect(harness.fit).not.toHaveBeenCalled()
    const element = 'elements' in harness ? harness.elements[0] : harness.markerRecords[0].content
    element.dispatchEvent(new Event('click'))
    expect(selected).toHaveBeenCalledWith('a')
    handle.setMarkers([])
    element.dispatchEvent(new Event('click'))
    expect(selected).toHaveBeenCalledTimes(1)
    handle.destroy()
  })

  it('rejects duplicate IDs before replacing valid markers', async () => {
    const harness = setup()
    const handle = await harness.renderer.mount(document.createElement('div'), { center, zoom: 10 })
    handle.setMarkers(points)
    expect(() => handle.setMarkers([points[0], points[0]])).toThrow('圖釘 ID')
    handle.fitMarkers()
    expect(harness.fit).toHaveBeenCalledTimes(1)
    handle.destroy()
  })

  it('supports focus, explicit fit and idempotent destruction', async () => {
    const harness = setup()
    const handle = await harness.renderer.mount(document.createElement('div'), { center, zoom: 10, maxZoom: 17 })
    handle.focus(center, 22)
    expect(harness.focus).toHaveBeenCalledTimes(1)
    handle.setMarkers(points)
    handle.fitMarkers()
    handle.fitBounds({ west: 170, east: -170, south: -10, north: 10 })
    expect(harness.fit).toHaveBeenCalledTimes(2)
    handle.destroy()
    handle.destroy()
    handle.focus(center)
    handle.setMarkers(points)
    handle.fitMarkers()
    expect(harness.focus).toHaveBeenCalledTimes(1)
    expect(harness.fit).toHaveBeenCalledTimes(2)
    if ('clear' in harness) {
      expect(harness.clear).toHaveBeenCalledTimes(1)
      expect(harness.zoom).toHaveBeenCalledWith(17)
      expect(harness.markerRecords.every(marker => marker.map === null)).toBe(true)
    } else {
      expect(harness.remove).toHaveBeenCalledTimes(1)
      expect(removeObserver).toHaveBeenCalledTimes(1)
      expect(harness.fit.mock.calls[1][0]).toEqual([[170, -10], [190, 10]])
    }
  })

  it('rejects invalid coordinates before loading an SDK', async () => {
    const harness = setup()
    await expect(harness.renderer.mount(document.createElement('div'), {
      center: { latitude: NaN, longitude: 127 }, zoom: 10,
    })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('cancels before initialization', async () => {
    const harness = setup()
    const controller = new AbortController()
    controller.abort()
    await expect(harness.renderer.mount(document.createElement('div'), {
      center, zoom: 10, signal: controller.signal,
    })).rejects.toMatchObject({ code: 'CANCELLED' })
  })

  it('cleans up a cancelled in-flight map', async () => {
    const harness = provider === 'google' ? googleHarness(false) : osmHarness(false)
    const controller = new AbortController()
    const pending = harness.renderer.mount(document.createElement('div'), { center, zoom: 10, signal: controller.signal })
    await Promise.resolve()
    await Promise.resolve()
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' })
    if ('clear' in harness) expect(harness.clear).toHaveBeenCalledTimes(1)
    else expect(harness.remove).toHaveBeenCalledTimes(1)
  })
})

it('does not create a renderer host after a slow SDK load is cancelled', async () => {
  let finish: (sdk: GoogleRendererSdk) => void = () => {}
  const sdk = new Promise<GoogleRendererSdk>(resolve => { finish = resolve })
  const renderer = createGoogleRenderer(() => sdk)
  const host = document.createElement('div')
  const controller = new AbortController()
  const pending = renderer.mount(host, { center, zoom: 10, signal: controller.signal })
  controller.abort()
  await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' })
  const fakeSdk: GoogleRendererSdk = {
    Map: class {
      setCenter() {}
      setZoom() {}
      fitBounds() {}
      addListener() { return { remove() {} } }
    },
    AdvancedMarkerElement: class { map = null },
    clearInstanceListeners() {},
  }
  finish(fakeSdk)
  await Promise.resolve()
  expect(host.children).toHaveLength(0)
})

it('reports post-load OSM errors and removes the listener on destroy', async () => {
  const harness = osmHarness()
  const onError = vi.fn()
  const handle = await harness.renderer.mount(document.createElement('div'), { center, zoom: 10, events: { onError } })
  for (const listener of harness.errors) listener({ error: new Error('tile missing') })
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'SERVICE_UNAVAILABLE', message: 'tile missing' }))
  handle.destroy()
  expect(harness.errors.size).toBe(0)
})

it('cleans up a timed-out map rather than returning a ready handle', async () => {
  vi.useFakeTimers()
  const harness = osmHarness(false)
  const result = harness.renderer.mount(document.createElement('div'), { center, zoom: 10 })
  const assertion = expect(result).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' })
  await vi.advanceTimersByTimeAsync(60000)
  await assertion
  expect(harness.remove).toHaveBeenCalledTimes(1)
  expect(harness.errors.size).toBe(0)
})

it('finds the shortest marker bounds across the date line', () => {
  expect(markerBounds([
    { id: 'a', name: 'A', coordinate: { latitude: 1, longitude: 179 } },
    { id: 'b', name: 'B', coordinate: { latitude: 2, longitude: -179 } },
  ])).toEqual({ north: 2, south: 1, west: 179, east: -179 })
  expect(markerBounds([])).toBeUndefined()
})

it('accepts either provider through the same renderer contract', () => {
  const renderers: readonly MapRenderer[] = [googleHarness().renderer, osmHarness().renderer]
  expect(renderers.every(renderer => typeof renderer.mount === 'function')).toBe(true)
})

it('rejects an already reported Google authorization error before creating a map', async () => {
  const harness = googleHarness()
  const unsubscribe = vi.fn()
  const renderer = createGoogleRenderer(async () => ({
    ...harness.sdk,
    subscribeErrors(listener) { listener(new Error('authorization denied')); return unsubscribe },
  }))
  await expect(renderer.mount(document.createElement('div'), { center, zoom: 10 }))
    .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', message: 'authorization denied' })
  expect(unsubscribe).toHaveBeenCalledTimes(1)
})

it('reports Google authorization failures arriving after idle and unsubscribes on destroy', async () => {
  const harness = googleHarness()
  let report: (error: Error) => void = () => {}
  const unsubscribe = vi.fn()
  const renderer = createGoogleRenderer(async () => ({
    ...harness.sdk,
    subscribeErrors(listener) { report = listener; return unsubscribe },
  }))
  const onError = vi.fn()
  const handle = await renderer.mount(document.createElement('div'), { center, zoom: 10, events: { onError } })
  report(new Error('authorization denied'))
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'SERVICE_UNAVAILABLE' }))
  handle.destroy()
  report(new Error('late'))
  expect(onError).toHaveBeenCalledTimes(1)
  expect(unsubscribe).toHaveBeenCalledTimes(1)
})

it('loads only maps and marker, chains the existing Google auth handler, and remembers failures', async () => {
  const harness = googleHarness()
  const previous = vi.fn()
  const importLibrary = vi.fn(async (name: string) => name === 'maps'
    ? { Map: harness.sdk.Map } : { AdvancedMarkerElement: harness.sdk.AdvancedMarkerElement })
  const target = { google: { maps: { importLibrary, event: { clearInstanceListeners: vi.fn() } } }, gm_authFailure: previous }
  vi.stubGlobal('window', target)
  const sdk = await createGoogleSdkLoader('test-key')()
  expect(importLibrary.mock.calls).toEqual([['maps'], ['marker']])
  const errors = vi.fn()
  const unsubscribe = sdk.subscribeErrors?.(errors)
  target.gm_authFailure()
  expect(previous).toHaveBeenCalledTimes(1)
  expect(errors).toHaveBeenCalledWith(expect.objectContaining({ code: 'SERVICE_UNAVAILABLE' }))
  unsubscribe?.()
  const later = vi.fn()
  sdk.subscribeErrors?.(later)()
  expect(later).toHaveBeenCalledTimes(1)
})

it('draws road geometry in a native line layer and clears it without duplicating the layer', async () => {
  const harness = osmHarness()
  const handle = await harness.renderer.mount(document.createElement('div'), { center, zoom: 10 })
  handle.setRoute?.([[center, { latitude: 27, longitude: 128 }]])
  expect(harness.addSource).toHaveBeenCalledWith('tripmap-itinerary-route', expect.objectContaining({
    data: expect.objectContaining({ features: [expect.objectContaining({ geometry: { type: 'LineString', coordinates: [[127, 26], [128, 27]] } })] }),
  }))
  handle.setRoute?.([])
  expect(harness.setData).toHaveBeenLastCalledWith({ type: 'FeatureCollection', features: [] })
  expect(harness.addLayer).toHaveBeenCalledTimes(1)
  handle.destroy()
})
