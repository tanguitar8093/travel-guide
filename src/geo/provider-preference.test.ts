import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getMapProvider, setMapProvider } from './provider-preference'

const key = 'travel-planner:map-provider'
let values: Map<string, string>
let target: EventTarget
const read = vi.fn()
const write = vi.fn()

beforeEach(() => {
  values = new Map()
  target = new EventTarget()
  read.mockReset().mockImplementation((name: string) => values.get(name) ?? null)
  write.mockReset().mockImplementation((name: string, value: string) => { values.set(name, value) })
  vi.stubGlobal('window', {
    localStorage: { getItem: read, setItem: write },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('device map preference', () => {
  it('defaults to OSM without writing a migration or business record', () => {
    expect(getMapProvider()).toBe('osm')
    expect(write).not.toHaveBeenCalled()
  })

  it('persists OSM, notifies the current page, and reads saved preferences again', () => {
    const changed = vi.fn()
    target.addEventListener('travel-planner:map-provider-change', changed)
    setMapProvider('osm')
    expect(write).toHaveBeenCalledExactlyOnceWith(key, 'osm')
    expect(changed).toHaveBeenCalledOnce()
    expect(getMapProvider()).toBe('osm')
    setMapProvider('google')
    expect(getMapProvider()).toBe('google')
  })

  it('rejects corrupt preferences and storage failures rather than silently selecting Google', () => {
    values.set(key, 'unknown')
    expect(() => getMapProvider()).toThrow('無效')
    read.mockImplementation(() => { throw new Error('storage denied') })
    expect(() => getMapProvider()).toThrow('storage denied')
  })

  it('does not notify success when saving fails', () => {
    const changed = vi.fn()
    target.addEventListener('travel-planner:map-provider-change', changed)
    write.mockImplementation(() => { throw new Error('quota exceeded') })
    expect(() => setMapProvider('osm')).toThrow('quota exceeded')
    expect(changed).not.toHaveBeenCalled()
    expect(values.has(key)).toBe(false)
  })

  it('validates runtime input before touching storage', () => {
    // @ts-expect-error Deliberately exercising input received outside TypeScript.
    expect(() => setMapProvider('other')).toThrow('Google 或 OSM')
    expect(write).not.toHaveBeenCalled()
  })

  it('provides the OSM default during server rendering', () => {
    vi.stubGlobal('window', undefined)
    expect(getMapProvider()).toBe('osm')
  })
})
