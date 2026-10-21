import { useMemo, useRef, useState } from 'react'
import type { PublicItinerary, Region, Trip } from './models'
import { createPublicItineraryController } from './public-itinerary.controller'
import { SharingDialog } from './SharingDialog'
import { sharingErrorMessage } from './messages'
import { useAuth } from '../../auth/useAuth'

export function PublicationDialog({ operation, trip, regionName, published, onClose, onSuccess }: {
  operation: 'publish' | 'update' | 'withdraw'; trip: Trip; regionName: Region['name']; published?: PublicItinerary
  onClose(): void; onSuccess(message: string): void
}) {
  const { user } = useAuth()
  const publicItineraryController = useMemo(() => createPublicItineraryController(user?.id ?? ''), [user?.id])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const running = useRef(false)
  const title = operation === 'publish' ? '發佈到公開行程' : operation === 'update' ? '更新公開版本' : '下架公開行程'
  const label = operation === 'publish' ? '確認發佈' : operation === 'update' ? '確認更新' : '確認下架'
  async function confirm() {
    if (running.current) return
    running.current = true
    setBusy(true); setError('')
    try {
      if (operation === 'publish') await publicItineraryController.publish(trip.id)
      else if (operation === 'update') await publicItineraryController.update(published!.id, trip.id)
      else await publicItineraryController.withdraw(published!.id, trip.id)
      onSuccess(`「${trip.name}」${operation === 'publish' ? '已發佈' : operation === 'update' ? '的公開版本已更新' : '已下架'}。`)
    } catch (cause) { setError(sharingErrorMessage(cause)) }
    finally { running.current = false; setBusy(false) }
  }
  return <SharingDialog title={title} busy={busy} onClose={onClose}>
    <section className="sharing-summary"><strong>{trip.name}</strong><p>{regionName} · {trip.startDate} — {trip.endDate}</p></section>
    <p className="sharing-copy">{operation === 'withdraw'
      ? '下架後不再出現在公開列表，無法預覽或套用；原始行程與已套用的個人副本都會保留。'
      : operation === 'update'
        ? '以目前內容完整覆蓋公開版本，不做差異比對。保留新增日期，記錄更新日期；已套用的副本不受影響。'
        : '複製目前區域、行程引用的地點與每日安排。之後編輯或刪除來源，公開內容不會自動改變。'}</p>
    {operation !== 'withdraw' && <p className="sharing-details">保留行程項目備註；私人標籤與地點備註不會公開。</p>}
    {error && <p className="itinerary-feedback itinerary-error" role="alert">{error}</p>}
    <footer className="itinerary-delete-dialog-actions"><button type="button" className="itinerary-secondary" disabled={busy} onClick={onClose}>取消</button>
      <button type="button" className={operation === 'withdraw' ? 'itinerary-delete' : 'itinerary-primary'} disabled={busy} onClick={() => void confirm()}>{busy ? '儲存中…' : label}</button>
    </footer>
  </SharingDialog>
}
