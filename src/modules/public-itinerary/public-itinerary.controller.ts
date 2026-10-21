import { liveQuery } from 'dexie'
import { database } from '../../database/database'
import { getDatabaseMode } from '../../database/runtime'
import { requireHybridStore, runHybridTask } from '../../database/hybrid.runtime'
import { createPublicItineraryCore } from './core'
import type { PublicItineraryCore } from './models'

export function publicSharingAvailable() { return getDatabaseMode() !== 'supabase' }

async function read<Result>(work: (core: PublicItineraryCore) => Promise<Result>): Promise<Result> {
  const mode = getDatabaseMode()
  if (mode === 'supabase') throw new Error('請切換至本機工作區使用公開行程。')
  return mode === 'indexeddb' ? work(createPublicItineraryCore(database))
    : requireHybridStore().readDatabase(db => work(createPublicItineraryCore(db)))
}
async function write<Result>(operation: string, work: (core: PublicItineraryCore) => Promise<Result>): Promise<Result> {
  const mode = getDatabaseMode()
  if (mode === 'supabase') throw new Error('請切換至本機工作區使用公開行程。')
  return mode === 'indexeddb' ? work(createPublicItineraryCore(database))
    : runHybridTask(store => store.mutateDatabase(`publicItineraries.${operation}`, db => work(createPublicItineraryCore(db))))
}
export const publicItineraryController: PublicItineraryCore & {
  subscribe(next: (rows: Awaited<ReturnType<PublicItineraryCore['list']>>) => void, error: (cause: unknown) => void): () => void
} = {
  list: query => read(core => core.list(query)),
  readSnapshot: id => read(core => core.readSnapshot(id)),
  findBySource: id => read(core => core.findBySource(id)),
  publish: id => write('publish', core => core.publish(id)),
  update: (id, sourceId) => write('update', core => core.update(id, sourceId)),
  withdraw: (id, sourceId) => write('withdraw', core => core.withdraw(id, sourceId)),
  apply: id => write('apply', core => core.apply(id)),
  subscribe(next, error) {
    const subscription = liveQuery(() => read(core => core.list())).subscribe({ next, error })
    return () => subscription.unsubscribe()
  },
}
