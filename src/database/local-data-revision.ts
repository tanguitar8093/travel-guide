import Dexie from 'dexie'
import { database } from './database'
import { getDatabaseMode } from './runtime'
import { requireHybridStore } from './hybrid.runtime'

let revision = 0
const listeners = new Set<() => void>()
Dexie.on('storagemutated', parts => {
  try {
    const mode = getDatabaseMode()
    if (mode === 'supabase') return
    const name = mode === 'indexeddb' ? database.name : requireHybridStore().getSyncLockName()
    const tables = ['regions', 'places', 'labels', 'trips', 'itineraryItems', 'routeMaps', 'routeMapPlaces', 'publicItineraries']
    if (!Object.keys(parts).some(part => tables.some(table => part.startsWith(`idb://${name}/${table}/`)))) return
    revision++
    for (const listener of listeners) listener()
  } catch { /* An account switch can temporarily leave no active local workspace. */ }
})
export const getLocalDataRevision = () => revision
export function subscribeLocalDataRevision(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
