import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { useDatabaseMode } from '../../database'
import { useHybridStatus } from '../../database/useHybridStatus'
import type { SharedTripSnapshot } from '../../database/shared-trip.types'
import { sharedTripEditingEnabled } from '../../database/shared-trip.types'
import type { SyncTask } from '../../database/sync.types'
import { AdminInfo } from '../../common/AdminInfo'
import ItineraryModule from './ItineraryModule'
import { ItineraryController } from './itinerary.controller'
import { CollaborativeItineraryService } from './collaborative-itinerary.service'
import { sharedTripController } from './shared-trip.controller'

export default function ItineraryEntry() {
  const { user } = useAuth()
  const mode = useDatabaseMode()
  const hybrid = useHybridStatus()
  const scope = `${mode}:${user?.id ?? ''}`
  return <ItineraryWorkspace key={scope} ready={mode !== 'hybrid' || hybrid.ready} />
}

function ItineraryWorkspace({ ready }: { ready: boolean }) {
  const mode = useDatabaseMode()
  const controller = useMemo(() => new ItineraryController(new CollaborativeItineraryService()), [])
  const [snapshots, setSnapshots] = useState<SharedTripSnapshot[]>([])
  const [tasks, setTasks] = useState<SyncTask[]>([])
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const enabled = sharedTripEditingEnabled && mode !== 'indexeddb'

  const load = useCallback(async (refresh = false) => {
    const [next, queued] = await Promise.all([
      refresh ? sharedTripController.refresh() : sharedTripController.list(),
      sharedTripController.tasks(),
    ])
    setSnapshots(next)
    setTasks(queued)
  }, [])

  useEffect(() => {
    if (!enabled || !ready) return
    let active = true
    const reload = () => {
      void Promise.all([sharedTripController.list(), sharedTripController.tasks()]).then(([next, queued]) => {
        if (!active) return
        setSnapshots(next)
        setTasks(queued)
      }).catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : '載入共享行程失敗。')
      })
    }
    reload()
    let unsubscribe = () => {}
    try {
      unsubscribe = sharedTripController.subscribe(reload, (cause) => {
        if (active) setError(cause instanceof Error ? cause.message : '共享資料訂閱失敗。')
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '共享資料尚未準備好。')
    }
    return () => { active = false; unsubscribe() }
  }, [enabled, ready])

  async function run(work: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await work()
      await load()
      setRevision((value) => value + 1)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '共享行程操作失敗。')
    } finally {
      setBusy(false)
    }
  }

  async function refreshSharedTrips() {
    setBusy(true)
    setError('')
    try {
      await load(true)
    } finally {
      setBusy(false)
    }
  }

  const tripIds = [...new Set(tasks.flatMap((task) => task.sharedTrip ? [task.sharedTrip.tripId] : []))]
  const navigation = enabled ? <section aria-label="共享同步狀態">
    <AdminInfo>
      <button type="button" className="itinerary-secondary" disabled={busy || !ready}
        onClick={() => void run(async () => { await sharedTripController.refresh() })}>
        {busy ? '同步中…' : '重新載入／同步共享行程'}
      </button>
    </AdminInfo>
    {error && <p role="alert">{error}</p>}
    {tripIds.map((tripId) => {
      const pending = tasks.filter((task) => task.sharedTrip?.tripId === tripId)
      const conflict = pending.find((task) => task.sharedTrip?.conflict)?.sharedTrip?.conflict
      const taskError = pending.find((task) => task.error && !task.sharedTrip?.conflict)?.error
      if (!taskError && !conflict) return null
      return <div key={tripId}>
        {taskError && <p role="alert">{taskError}</p>}
        {conflict && <section aria-label="共享行程衝突處理">
          <p role="alert">共享行程或權限已改變，這趟行程的同步已暫停；本機變更仍保留。</p>
          <details><summary>查看雲端版本</summary><pre>{JSON.stringify(conflict.document, null, 2)}</pre></details>
          <details><summary>查看本機草稿</summary><pre>{JSON.stringify(pending.at(-1)?.sharedTrip?.after, null, 2)}</pre></details>
          {(['cloud', 'local'] as const).map((choice) => <button key={choice} type="button" className="itinerary-secondary"
            disabled={busy || (choice === 'local' && (!conflict.document || conflict.document.trip.access === 'viewer'))}
            onClick={() => {
              if (!window.confirm(choice === 'cloud' ? '確定放棄此共享行程的待同步草稿，採用雲端版本？' : '確定以此行程的本機完整草稿重新排入同步？其他人的變更可能被取代。')) return
              void run(() => sharedTripController.resolve(tripId, conflict, choice))
            }}>{choice === 'cloud' ? '採用雲端版本' : '保留本機草稿並重新同步'}</button>)}
        </section>}
      </div>
    })}
  </section> : undefined

  if (!ready) return <p role="status">正在準備本機行程工作區…</p>
  return <ItineraryModule controller={controller} sharedNavigation={navigation}
    sourceRevision={JSON.stringify([revision, snapshots, tasks])}
    sharedTripIds={enabled ? snapshots.filter((snapshot) => snapshot.document).map((snapshot) => snapshot.id) : []}
    sharedSyncBusy={busy}
    onRefreshSharedTrips={refreshSharedTrips}
    onCollaborationChange={() => {
      if (enabled) void run(async () => { await sharedTripController.refresh() })
    }} />
}
