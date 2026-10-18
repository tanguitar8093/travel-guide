import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../../auth/useAuth'
import { useDatabaseMode } from '../../database'
import type { CollaborationDetails, CollaborationList, TripMemberRole } from '../../database'
import { tripCollaborationController } from './trip-collaboration.controller'
import './TripCollaborationPanel.css'

const roleLabels = { viewer: '唯讀', editor: '可編輯', owner: '擁有者' }

interface Props {
  preferredTripId?: string
  onClose(): void
}

export function TripCollaborationPanel({ preferredTripId, onClose }: Props) {
  const { user } = useAuth()
  const mode = useDatabaseMode()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const firstInputRef = useRef<HTMLSelectElement>(null)
  const inviteInputRef = useRef<HTMLInputElement>(null)
  const [listing, setListing] = useState<CollaborationList>()
  const [details, setDetails] = useState<CollaborationDetails>()
  const [tripId, setTripId] = useState(preferredTripId ?? '')
  const [invitee, setInvitee] = useState('')
  const [role, setRole] = useState<TripMemberRole>('viewer')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const generation = useRef(0)
  const actionActive = useRef(false)

  useEffect(() => {
    const dialog = dialogRef.current
    const previousFocus = document.activeElement
    dialog?.showModal()
    return () => {
      dialog?.close()
      if (previousFocus instanceof HTMLElement) previousFocus.focus()
    }
  }, [])

  const load = useCallback(async (preferred: string, currentGeneration: number) => {
    const next = await tripCollaborationController.list()
    if (generation.current !== currentGeneration) return
    setListing(next)
    const nextTripId = next.trips.some((trip) => trip.id === preferred) ? preferred : next.trips[0]?.id ?? ''
    setTripId(nextTripId)
    setDetails(undefined)
    if (nextTripId) {
      const nextDetails = await tripCollaborationController.details(nextTripId)
      if (generation.current === currentGeneration) setDetails(nextDetails)
    }
  }, [])

  useEffect(() => {
    const current = ++generation.current
    setLoading(true)
    setBusy(false)
    setListing(undefined)
    setDetails(undefined)
    setInvitee('')
    setRole('viewer')
    setError('')
    void load(preferredTripId ?? '', current)
      .catch((cause: unknown) => {
        if (generation.current === current) setError(cause instanceof Error ? cause.message : '載入協作資料失敗。')
      })
      .finally(() => {
        if (generation.current === current) setLoading(false)
      })
    return () => { generation.current += 1 }
  }, [load, preferredTripId, user?.id, mode])

  useEffect(() => {
    if (!loading && listing) firstInputRef.current?.focus()
  }, [loading, listing])

  async function changeTrip(nextTripId: string) {
    const current = ++generation.current
    setTripId(nextTripId)
    setDetails(undefined)
    setError('')
    setNotice('')
    setLoading(true)
    try {
      const next = await tripCollaborationController.details(nextTripId)
      if (generation.current === current) setDetails(next)
    } catch (cause) {
      if (generation.current === current) setError(cause instanceof Error ? cause.message : '載入分享行程失敗。')
    } finally {
      if (generation.current === current) setLoading(false)
    }
  }

  async function run(action: () => Promise<void>, message: string) {
    if (actionActive.current) return
    actionActive.current = true
    const current = ++generation.current
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      if (generation.current !== current) return
      setNotice(message)
      try {
        await load(tripId, current)
      } catch (cause) {
        if (generation.current === current) {
          setDetails(undefined)
          setError(`操作已完成，但重新載入失敗：${cause instanceof Error ? cause.message : '請重新整理確認最新狀態。'}`)
        }
      }
    } catch (cause) {
      if (generation.current === current) setError(cause instanceof Error ? cause.message : '協作操作失敗。')
    } finally {
      actionActive.current = false
      if (generation.current === current) setBusy(false)
    }
  }

  function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!details) return
    void run(async () => {
      await tripCollaborationController.invite(details.trip.id, invitee, role)
      setInvitee('')
    }, '邀請已送出。對方接受後才會取得行程權限。')
  }

  const pendingInvitations = listing?.invitations.filter((invitation) =>
    !invitation.acceptedAt && !invitation.revokedAt && Date.parse(invitation.expiresAt) > Date.now(),
  ) ?? []
  const canManage = details?.trip.access === 'owner'
  const places = new Map(details?.places.map((place) => [place.id, place]))

  return (
    <dialog ref={dialogRef} className="trip-collaboration-dialog" aria-labelledby="trip-collaboration-title"
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose() }}>
      <header className="trip-collaboration-heading">
        <h2 id="trip-collaboration-title">行程協作預覽</h2>
        <button type="button" className="itinerary-secondary" disabled={busy} onClick={onClose}>關閉</button>
      </header>
      <p className="trip-collaboration-warning">
        此階段提供邀請、權限管理與唯讀預覽，尚未開放共同編輯或離線協作。
        需連線；混合模式僅顯示已同步到雲端的行程，不搬移或覆蓋本機資料。
      </p>
      <p className="trip-collaboration-account">我的帳號 ID：<code>{user?.id}</code>（提供此 ID 給邀請人）</p>
      {error && <p className="itinerary-feedback itinerary-error" role="alert">{error}</p>}
      {notice && <p className="itinerary-feedback itinerary-success" role="status">{notice}</p>}
      {loading && <p role="status">正在載入協作資料…</p>}
      {error && !busy && <button type="button" className="itinerary-secondary" onClick={() =>
        void run(async () => {}, '已重新載入協作資料。')
      }>重新載入</button>}
      {pendingInvitations.length > 0 && <section aria-label="收到的行程邀請">
        <h3>收到的邀請</h3>
        <ul className="trip-collaboration-list">{pendingInvitations.map((invitation) => (
          <li key={invitation.id}>
            <span>{invitation.tripName} · {roleLabels[invitation.role]}</span>
            <button type="button" className="itinerary-primary" disabled={busy || loading}
              onClick={() => void run(() => tripCollaborationController.accept(invitation.tripId, invitation.id), '已接受邀請。')}>
              接受邀請
            </button>
          </li>
        ))}</ul>
      </section>}
      {listing && <label className="itinerary-field">
        <span>選擇雲端行程</span>
        <select ref={firstInputRef} value={tripId} disabled={busy || loading || !listing.trips.length}
          onChange={(event) => void changeTrip(event.target.value)}>
          {!listing.trips.length && <option value="">沒有可存取的雲端行程</option>}
          {listing.trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.name} · {roleLabels[trip.access]}</option>)}
        </select>
      </label>}
      {details && <>
        <p>{details.trip.startDate} — {details.trip.endDate} · {roleLabels[details.trip.access]}</p>
        {canManage && <form className="trip-collaboration-invite" onSubmit={submitInvite}>
          <h3>邀請既有帳號</h3>
          <label className="itinerary-field">
            <span>對方帳號 ID（UUID）</span>
            <input ref={inviteInputRef} required value={invitee} disabled={busy || loading}
              onChange={(event) => setInvitee(event.target.value)} autoComplete="off" />
          </label>
          <label className="itinerary-field">
            <span>接受後的權限</span>
            <select value={role} disabled={busy || loading} onChange={(event) => setRole(event.target.value === 'editor' ? 'editor' : 'viewer')}>
              <option value="viewer">唯讀</option>
              <option value="editor">可編輯（共同編輯介面尚未開放）</option>
            </select>
          </label>
          <button type="submit" className="itinerary-primary" disabled={busy || loading || !invitee.trim()}>送出邀請</button>
        </form>}
        <section aria-label="行程成員">
          <h3>行程成員</h3>
          <p>擁有者：<code>{details.trip.ownerUid}</code></p>
          <ul className="trip-collaboration-list">{details.members.map((member) => (
            <li key={member.userId}>
              <code>{member.userId}</code>
              {canManage ? <>
                <select aria-label={`${member.userId} 的權限`} value={member.role} disabled={busy || loading}
                  onChange={(event) => void run(() => tripCollaborationController.setMember(details.trip.id, member.userId,
                    event.target.value === 'editor' ? 'editor' : 'viewer'), '成員權限已更新。')}>
                  <option value="viewer">唯讀</option><option value="editor">可編輯</option>
                </select>
                <button type="button" className="itinerary-delete" disabled={busy || loading}
                  onClick={() => {
                    if (window.confirm('確定移除此成員的行程存取權限？')) {
                      void run(() => tripCollaborationController.removeMember(details.trip.id, member.userId), '已移除成員。')
                    }
                  }}>移除</button>
              </> : <span>{roleLabels[member.role]}</span>}
            </li>
          ))}</ul>
          {!canManage && <button type="button" className="itinerary-delete" disabled={busy || loading}
            onClick={() => {
              if (window.confirm('確定退出這個協作行程？需要重新受邀才能再次加入。')) {
                void run(() => tripCollaborationController.leave(details.trip.id), '已退出行程。')
              }
            }}>退出行程</button>}
        </section>
        {canManage && details.invitations.length > 0 && <section aria-label="送出的邀請">
          <h3>送出的邀請</h3>
          <ul className="trip-collaboration-list">{details.invitations.map((invitation) => (
            <li key={invitation.id}>
              <code>{invitation.inviteeUserId}</code>
              <span>{roleLabels[invitation.role]} · {invitation.revokedAt ? '已撤銷' : invitation.acceptedAt ? '已接受' :
                Date.parse(invitation.expiresAt) <= Date.now() ? '已過期' : '待接受'}</span>
              {!invitation.acceptedAt && !invitation.revokedAt && <button type="button" className="itinerary-secondary" disabled={busy || loading}
                onClick={() => void run(() => tripCollaborationController.revokeInvitation(details.trip.id, invitation.id), '邀請已撤銷。')}>撤銷</button>}
            </li>
          ))}</ul>
        </section>}
        <section aria-label="共享行程唯讀預覽">
          <h3>行程內容（唯讀）</h3>
          {!details.items.length && <p>這趟行程尚未安排地點。</p>}
          <ol className="trip-collaboration-items">{[...details.items].sort((left, right) =>
            left.date.localeCompare(right.date) || left.order - right.order,
          ).map((item) => (
            <li key={item.id}>
              <strong>{item.date} {item.arrivalTime ?? ''} · {places.get(item.placeId)?.name ?? '無法取得地點名稱'}</strong>
              {item.durationMinutes !== undefined && <span>停留 {item.durationMinutes} 分鐘</span>}
              {item.note && <p>{item.note}</p>}
            </li>
          ))}</ol>
          <p>只顯示此行程安排的地點，不提供私人收藏筆記或標籤。</p>
        </section>
      </>}
    </dialog>
  )
}
