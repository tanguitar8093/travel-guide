import { afterEach, beforeEach, expect, it, vi } from 'vitest'

class Autocomplete extends EventTarget {
  value = 'query'
  setAttribute = vi.fn()
  remove = vi.fn()
}

const markers: { map: object | null; content: HTMLElement }[] = []
const fitBounds = vi.fn()
const setOptions = vi.fn()
const extend = vi.fn()
let autocomplete: Autocomplete

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
  markers.length = 0
  fitBounds.mockReset()
  setOptions.mockReset()
  extend.mockReset()
  vi.stubGlobal('document', {
    createElement: () => ({ style: {}, replaceChildren: vi.fn(), remove: vi.fn() }),
  })
  class Bounds {
    extend(position: object) { extend(position); return this }
  }
  class Map {
    fitBounds = fitBounds
    setOptions = setOptions
  }
  class Marker {
    map: object | null
    content: HTMLElement
    constructor(options: { map: object; content: HTMLElement }) {
      this.map = options.map
      this.content = options.content
      markers.push(this)
    }
    addEventListener = vi.fn()
    removeEventListener = vi.fn()
  }
  class Search extends Autocomplete {
    constructor() { super(); autocomplete = this }
  }
  vi.stubGlobal('window', { google: { maps: {
    importLibrary: async (name: string) => {
      if (name === 'places') return { PlaceAutocompleteElement: Search }
      if (name === 'maps') return { Map }
      if (name === 'core') return { LatLngBounds: Bounds }
      return { AdvancedMarkerElement: Marker }
    },
  } } })
})

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

it('restores the initial viewport independently of fitting markers', async () => {
  const { mountGoogleMap } = await import('./google-places.service')
  const center = { lat: 25, lng: 121 }
  const handle = await mountGoogleMap(document.createElement('div'), { center, zoom: 12 })
  handle.resetView()
  expect(setOptions).toHaveBeenCalledExactlyOnceWith({ center, zoom: 12 })
  handle.destroy()
  const viewport = { north: 26, south: 24, east: 122, west: 120 }
  const bounded = await mountGoogleMap(document.createElement('div'), { center, zoom: 12, viewport })
  fitBounds.mockClear()
  bounded.resetView()
  expect(fitBounds).toHaveBeenCalledExactlyOnceWith(viewport)
  bounded.destroy()
})

it('applies a supplied marker color while leaving legacy marker styles unchanged', async () => {
  const { mountGoogleMap } = await import('./google-places.service')
  const map = await mountGoogleMap(document.createElement('div'), { center: { lat: 25, lng: 121 }, zoom: 12 })
  map.setMarkers([
    { id: 'legacy', title: 'Legacy', position: { lat: 25, lng: 121 } },
    { id: 'added', title: 'Added', position: { lat: 26, lng: 122 }, sequence: 1, color: '#b96522' },
  ])
  expect(markers[0].content.style.backgroundColor).toBeUndefined()
  expect(markers[0].content.className).toBe('google-map-marker')
  expect(markers[1].content.style.backgroundColor).toBe('#b96522')
  expect(markers[1].content.textContent).toBe('1')
  map.destroy()
})

it('only enlarges the selected marker and preserves color, numbering and viewport', async () => {
  const { mountGoogleMap } = await import('./google-places.service')
  const map = await mountGoogleMap(document.createElement('div'), { center: { lat: 25, lng: 121 }, zoom: 12 })
  const points = [
    { id: 'a', title: 'A', position: { lat: 25, lng: 121 }, color: '#6d91ad', sequence: 1 },
    { id: 'b', title: 'B', position: { lat: 26, lng: 122 }, color: '#b96522' },
  ]
  map.setMarkers(points.map((point) => ({ ...point, enlarged: point.id === 'a' })))
  expect(markers[0].content.className).toBe('google-map-marker google-map-marker-numbered google-map-marker-enlarged')
  expect(markers[0].content.style.transform).toBeUndefined()
  expect(markers[0].content.style.backgroundColor).toBe('#6d91ad')
  expect(markers[0].content.textContent).toBe('1')
  expect(markers[1].content.style.transform).toBeUndefined()
  expect(markers[1].content.className).toBe('google-map-marker')
  map.setMarkers(points.map((point) => ({ ...point, enlarged: point.id === 'b' })))
  expect(markers[2].content.style.transform).toBeUndefined()
  expect(markers[2].content.className).toBe('google-map-marker google-map-marker-numbered')
  expect(markers[2].content.textContent).toBe('1')
  expect(markers[3].content.className).toBe('google-map-marker google-map-marker-enlarged')
  expect(markers[3].content.style.backgroundColor).toBe('#b96522')
  expect(fitBounds).not.toHaveBeenCalled()
  map.destroy()
})

it('fits both endpoint markers only when requested and removes markers on cleanup', async () => {
  const { mountGoogleMap } = await import('./google-places.service')
  const map = await mountGoogleMap(document.createElement('div'), { center: { lat: 25, lng: 121 }, zoom: 12 })
  const points = [
    { id: 'a', title: 'A', position: { lat: 25, lng: 121 }, sequence: 1 },
    { id: 'b', title: 'B', position: { lat: 26, lng: 122 }, sequence: 2 },
  ]
  map.setMarkers(points)
  expect(fitBounds).not.toHaveBeenCalled()
  map.setMarkers(points, { fitBounds: true })
  expect(extend.mock.calls).toEqual([[points[0].position], [points[1].position]])
  expect(fitBounds).toHaveBeenCalledTimes(1)
  expect(markers.slice(0, 2).every((marker) => marker.map === null)).toBe(true)
  map.destroy()
  expect(markers.every((marker) => marker.map === null)).toBe(true)
})

it('invalidates an in-flight selection when the user types another query', async () => {
  const { mountPlaceAutocomplete } = await import('./google-places.service')
  const selected = vi.fn()
  const input = vi.fn()
  let finish: () => void = () => {}
  const pending = new Promise<void>((resolve) => { finish = resolve })
  const destroy = await mountPlaceAutocomplete(document.createElement('div'), selected, vi.fn(), { onInput: input })
  autocomplete.dispatchEvent(Object.assign(new Event('gmp-select'), {
    placePrediction: { toPlace: () => ({ id: 'old', fetchFields: () => pending }) },
  }))
  autocomplete.dispatchEvent(new Event('input'))
  finish()
  await pending
  await Promise.resolve()
  expect(input).toHaveBeenCalledTimes(2)
  expect(selected).not.toHaveBeenCalled()
  destroy()
})

it('ignores place-detail responses after autocomplete is destroyed', async () => {
  const { mountPlaceAutocomplete } = await import('./google-places.service')
  const selected = vi.fn()
  let finish: () => void = () => {}
  const pending = new Promise<void>((resolve) => { finish = resolve })
  const destroy = await mountPlaceAutocomplete(document.createElement('div'), selected, vi.fn())
  autocomplete.dispatchEvent(Object.assign(new Event('gmp-select'), {
    placePrediction: { toPlace: () => ({ id: 'old', fetchFields: () => pending }) },
  }))
  destroy()
  finish()
  await pending
  await Promise.resolve()
  expect(selected).not.toHaveBeenCalled()
  expect(autocomplete.remove).toHaveBeenCalledTimes(1)
})

it('fits the day subset without hiding other markers, and ignores an empty subset', async () => {
  const { mountGoogleMap } = await import('./google-places.service')
  const map = await mountGoogleMap(document.createElement('div'), { center: { lat: 25, lng: 121 }, zoom: 12 })
  const points = [
    { id: 'today', title: 'Today', position: { lat: 25, lng: 121 }, sequence: 1 },
    { id: 'other', title: 'Other', position: { lat: 35, lng: 140 } },
  ]
  map.setMarkers(points, { fitBounds: true, fitMarkerIds: ['today'] })
  expect(extend.mock.calls).toEqual([[points[0].position]])
  expect(markers).toHaveLength(2)
  expect(markers.every(marker => marker.map !== null)).toBe(true)
  fitBounds.mockClear()
  map.setMarkers(points, { fitBounds: true, fitMarkerIds: [] })
  expect(fitBounds).not.toHaveBeenCalled()
  map.destroy()
})
