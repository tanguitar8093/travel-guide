import 'fake-indexeddb/auto'
import { afterEach, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
const state = vi.hoisted(() => ({ mode: 'indexeddb', name: 'travel-planner', ready: true }))
vi.mock('./runtime', () => ({ getDatabaseMode: () => state.mode }))
vi.mock('./hybrid.runtime', () => ({ requireHybridStore: () => {
  if (!state.ready) throw new Error('not ready')
  return { getSyncLockName: () => state.name }
} }))
import { getLocalDataRevision, subscribeLocalDataRevision } from './local-data-revision'
afterEach(() => { state.mode = 'indexeddb'; state.name = 'travel-planner'; state.ready = true })
function emit(name: string, table: string) {
  Dexie.on.storagemutated.fire({ [`idb://${name}/${table}/`]: { d: 0 } })
}
it('refreshes after committed personal writes but ignores other databases and sync bookkeeping', () => {
  const listener = vi.fn()
  const unsubscribe = subscribeLocalDataRevision(listener)
  const initial = getLocalDataRevision()
  emit('other-poc', 'trips')
  emit('travel-planner', 'syncMetadata')
  expect(listener).not.toHaveBeenCalled()
  emit('travel-planner', 'trips')
  expect(listener).toHaveBeenCalledOnce()
  expect(getLocalDataRevision()).toBe(initial + 1)
  unsubscribe()
})
it('follows the active account workspace and ignores writes during switching or cloud mode', () => {
  state.mode = 'hybrid'; state.name = 'account-a'
  const listener = vi.fn()
  const unsubscribe = subscribeLocalDataRevision(listener)
  emit('account-b', 'places')
  emit('account-a', 'places')
  expect(listener).toHaveBeenCalledOnce()
  state.ready = false
  emit('account-a', 'places')
  state.mode = 'supabase'
  emit('account-a', 'places')
  expect(listener).toHaveBeenCalledOnce()
  unsubscribe()
})
