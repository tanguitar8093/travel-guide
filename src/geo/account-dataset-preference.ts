import { useSyncExternalStore } from 'react'
import { supabase } from '../database/supabase.client'
import { AccountDatasetSync, readPendingDataset } from './account-dataset-sync'
import { getOsmDataset, osmDatasetChangeEvent, setOsmDataset } from './osm-dataset-preference'
import { isOsmDatasetId, type OsmDatasetId } from './osm-datasets'

const metadataKey = 'tripmap_osm_dataset'
let current: { userId: string; sync: AccountDatasetSync; dispose(): void } | undefined
export const datasetSyncStatusEvent = 'travel-planner:dataset-sync-status'
let syncError: string | undefined
export function getDatasetSyncError() { return syncError }
function subscribeStatus(listener: () => void) {
  window.addEventListener(datasetSyncStatusEvent, listener)
  return () => window.removeEventListener(datasetSyncStatusEvent, listener)
}
export function useDatasetSyncError() {
  return useSyncExternalStore(subscribeStatus, getDatasetSyncError, () => undefined)
}
function report(error?: string) {
  syncError = error
  window.dispatchEvent(new Event(datasetSyncStatusEvent))
}

// Capture a token for the intended account before the request. An account switch
// cannot redirect a delayed preference write into the newly signed-in account.
async function userRequest(userId: string, dataset?: OsmDatasetId) {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  if (data.session?.user.id !== userId) throw new Error('帳號已切換，已停止同步原帳號的區域設定。')
  const apiUrl = import.meta.env.VITE_SUPABASE_URL
  const apiKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!apiUrl || !apiKey) throw new Error('缺少 Supabase 設定。')
  const response = await fetch(`${apiUrl}/auth/v1/user`, {
    method: dataset === undefined ? 'GET' : 'PUT',
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${data.session.access_token}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(10000),
    ...(dataset === undefined ? {} : { body: JSON.stringify({ data: { [metadataKey]: dataset } }) }),
  })
  if (!response.ok) throw new Error('區域設定尚未同步至帳號，連線恢復後會自動重試。')
  const user = await response.json() as { id?: string; user_metadata?: Record<string, unknown> }
  if (user.id !== userId) throw new Error('區域設定回應的帳號不符。')
  const value = user.user_metadata?.[metadataKey]
  if (value !== undefined && value !== null && !isOsmDatasetId(value)) throw new Error('帳號的區域設定無效，請重新選擇區域。')
  return isOsmDatasetId(value) ? value : undefined
}

export function setDatasetPreferenceAccount(userId: string | null): Promise<void> {
  if (current?.userId === userId) return current.sync.refresh()
  current?.dispose()
  current = undefined
  report()
  if (!userId) return Promise.resolve()
  const pendingKey = `travel-planner:osm-dataset-pending:${userId}`
  const sync = new AccountDatasetSync({
    store: {
      get: () => readPendingDataset(window.localStorage, pendingKey),
      set: value => value ? window.localStorage.setItem(pendingKey, JSON.stringify(value)) : window.localStorage.removeItem(pendingKey),
    },
    read: () => userRequest(userId),
    write: async dataset => { await userRequest(userId, dataset) },
    apply: dataset => { if (getOsmDataset() !== dataset) setOsmDataset(dataset, 'cloud') },
    report,
  })
  const onSelection = (event: Event) => {
    if ((event as CustomEvent<{ source?: string }>).detail?.source !== 'cloud') void sync.select(getOsmDataset())
  }
  const refresh = () => { if (document.visibilityState !== 'hidden') void sync.refresh() }
  const onStorage = (event: StorageEvent) => { if (event.key === pendingKey) refresh() }
  window.addEventListener(osmDatasetChangeEvent, onSelection)
  window.addEventListener('focus', refresh)
  window.addEventListener('online', refresh)
  window.addEventListener('storage', onStorage)
  document.addEventListener('visibilitychange', refresh)
  const timer = setInterval(refresh, 15000)
  current = { userId, sync, dispose() {
    sync.stop()
    clearInterval(timer)
    window.removeEventListener(osmDatasetChangeEvent, onSelection)
    window.removeEventListener('focus', refresh)
    window.removeEventListener('online', refresh)
    window.removeEventListener('storage', onStorage)
    document.removeEventListener('visibilitychange', refresh)
  } }
  return sync.refresh()
}

export function refreshAccountDatasetPreference(): Promise<void> {
  return current?.sync.refresh() ?? Promise.resolve()
}
