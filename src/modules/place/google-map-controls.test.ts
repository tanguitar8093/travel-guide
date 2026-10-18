import { afterEach, beforeEach, expect, it, vi } from 'vitest'

class Autocomplete extends EventTarget {
  value = 'query'
  setAttribute = vi.fn()
  remove = vi.fn()
}

const markers: { map: object | null }[] = []
const fitBounds = vi.fn()
const extend = vi.fn()
let autocomplete: Autocomplete

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
  markers.length = 0
  fitBounds.mockReset()
  extend.mockReset()
  vi.stubGlobal('document', {
    createElement: () => ({ replaceChildren: vi.fn(), remove: vi.fn() }),
  })
  class Bounds {
    extend(position: object) { extend(position); return this }
  }
  class Map {
    fitBounds = fitBounds
  }
  class Marker {
    map: object | null
    constructor(options: { map: object }) { this.map = options.map; markers.push(this) }
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
