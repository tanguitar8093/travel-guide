import { useSyncExternalStore } from 'react'
import { isOsmDatasetId, type OsmDatasetId } from './osm-datasets'
const key = 'travel-planner:osm-dataset'
export const osmDatasetChangeEvent = 'travel-planner:osm-dataset-change'
export function getOsmDataset(): OsmDatasetId {
  const stored = typeof window === 'undefined' ? null : window.localStorage?.getItem(key) ?? null
  if (stored === null) return 'okinawa'
  if (!isOsmDatasetId(stored)) throw new Error('OSM 區域設定無效，請到區域頁面重新選擇。')
  return stored
}
export function setOsmDataset(dataset: OsmDatasetId, source: 'local' | 'cloud' = 'local'): void {
  if (!isOsmDatasetId(dataset)) throw new Error('不支援此 OSM 區域。')
  window.localStorage.setItem(key, dataset)
  window.dispatchEvent(new CustomEvent(osmDatasetChangeEvent, { detail: { source } }))
}
function snapshot(): string {
  try { return getOsmDataset() } catch { return 'invalid' }
}
function subscribe(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => { if (event.key === key || event.key === null) listener() }
  window.addEventListener(osmDatasetChangeEvent, listener)
  window.addEventListener('storage', onStorage)
  return () => { window.removeEventListener(osmDatasetChangeEvent, listener); window.removeEventListener('storage', onStorage) }
}
export function useOsmDataset(): OsmDatasetId | undefined {
  const id = useSyncExternalStore(subscribe, snapshot, () => 'okinawa')
  return isOsmDatasetId(id) ? id : undefined
}
