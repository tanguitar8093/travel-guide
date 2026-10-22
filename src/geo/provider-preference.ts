import { useSyncExternalStore } from 'react'
import type { GeoProvider } from './contracts'

const key = 'travel-planner:map-provider'
const eventName = 'travel-planner:map-provider-change'

export function getMapProvider(): GeoProvider {
  if (typeof window === 'undefined') return 'google'
  const value = window.localStorage.getItem(key)
  if (value === null || value === 'google') return 'google'
  if (value === 'osm') return 'osm'
  throw new Error('已儲存的地圖供應商設定無效，請在資料設定重新選擇。')
}

export function setMapProvider(provider: GeoProvider): void {
  if (provider !== 'google' && provider !== 'osm') throw new Error('地圖供應商必須是 Google 或 OSM。')
  window.localStorage.setItem(key, provider)
  window.dispatchEvent(new Event(eventName))
}

function snapshot(): string {
  try {
    return getMapProvider()
  } catch (cause) {
    return `error:${cause instanceof Error ? cause.message : '無法讀取地圖供應商設定。'}`
  }
}

function subscribe(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) listener()
  }
  window.addEventListener(eventName, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(eventName, listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useMapProvider(): { provider: GeoProvider | undefined; error?: string } {
  const value = useSyncExternalStore(subscribe, snapshot, () => 'google')
  return value === 'google' || value === 'osm' ? { provider: value } : { provider: undefined, error: value.slice(6) }
}
