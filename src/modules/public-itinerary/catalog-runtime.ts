import { publicCatalog } from './catalog-instance'
import { useSyncExternalStore } from 'react'
import type { PublicItineraryCatalog } from './shared-catalog'
import { createCatalogCloud } from './catalog-cloud'
import { discardCatalogConflict, syncPublicCatalog } from './catalog-sync'

interface CatalogStatus { syncing: boolean; pending: number; conflicts: Array<{ id: string; name: string }>; error?: string }
let status: CatalogStatus = { syncing: false, pending: 0, conflicts: [] }
const listeners = new Set<() => void>()
let generation = 0
let account = ''
let current: Promise<void> | undefined
let activeCatalog: PublicItineraryCatalog | undefined
let rerun = false
let timer: ReturnType<typeof setInterval> | undefined
let removeEvents = () => {}
export function setPublicCatalogAccount(ownerId: string | null) {
  if (timer) clearInterval(timer)
  removeEvents()
  generation++
  if (ownerId === null) { activeCatalog = undefined; account = ''; publish({ syncing: false, pending: 0, conflicts: [] }); return }
  activatePublicCatalog(publicCatalog, ownerId)
  const refresh = () => { void refreshPublicCatalog() }
  const foreground = () => { if (document.visibilityState === 'visible') refresh() }
  window.addEventListener('online', refresh)
  document.addEventListener('visibilitychange', foreground)
  removeEvents = () => { window.removeEventListener('online', refresh); document.removeEventListener('visibilitychange', foreground) }
  timer = setInterval(() => { if (document.visibilityState === 'visible') refresh() }, 60000)
  setTimeout(refresh, 0)
}
export function capturePublicCatalogAccount(ownerId: string) {
  const token = generation
  return () => { if (token !== generation || ownerId !== account) throw new Error('帳號已切換，公開行程操作已中止。') }
}
function publish(next: CatalogStatus) { status = next; listeners.forEach(listener => listener()) }
export function usePublicCatalogStatus() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener) }, () => status, () => status)
}
export function activatePublicCatalog(catalog: PublicItineraryCatalog, ownerId: string) {
  if (activeCatalog === catalog && account === ownerId) return
  generation++
  account = ownerId
  activeCatalog = catalog
  publish({ syncing: false, pending: 0, conflicts: [] })
}
export async function refreshPublicCatalog(): Promise<void> {
  if (!activeCatalog) return
  if (current) { rerun = true; await current; return }
  const catalog = activeCatalog
  const ownerId = account
  const token = generation
  const assertCurrent = () => { if (generation !== token) throw new Error('帳號已切換，公開行程同步已中止。') }
  current = (async () => {
    publish({ ...status, syncing: true, error: undefined })
    let error: string | undefined
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('目前離線；公開行程操作將在恢復連線後同步。')
      const work = () => syncPublicCatalog(catalog, createCatalogCloud(ownerId), ownerId, assertCurrent)
      if (typeof navigator !== 'undefined' && navigator.locks) await navigator.locks.request(`${catalog.name}:sync`, work)
      else await work()
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
    if (generation === token) {
      const tasks = await catalog.syncTasks.where('ownerId').equals(ownerId).toArray()
      const conflicts = await Promise.all(tasks.filter(task => task.conflict).map(async task => ({ id: task.id,
        name: task.snapshot?.trip.name ?? (await catalog.baselines.get(task.id))?.snapshot?.trip.name ?? '已下架行程' })))
      publish({ syncing: false, pending: tasks.length, conflicts, error })
    }
  })().finally(() => {
    current = undefined
    if (rerun) { rerun = false; void refreshPublicCatalog() }
  })
  await current
}
export async function acceptPublicCloudVersion(id: string) {
  if (!activeCatalog) return
  const catalog = activeCatalog
  const ownerId = account
  const assertCurrent = capturePublicCatalogAccount(ownerId)
  const work = async () => { assertCurrent(); await discardCatalogConflict(catalog, ownerId, id) }
  if (navigator.locks) await navigator.locks.request(`${catalog.name}:sync`, work)
  else await work()
  await refreshPublicCatalog()
}
