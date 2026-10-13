import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { ItineraryItem, NewTrip, Place, Region, Trip } from '../../database'
import { RouterLink } from '../../router'
import { routes } from '../../routes'
import { itineraryController } from './itinerary.controller'
import './ItineraryModule.css'

interface TripDraft {
  name: string
  regionId: string
  startDate: string
  endDate: string
}

interface ItemDraft {
  placeId: string
  date: string
  arrivalTime: string
  durationMinutes: string
  transport: string
  note: string
}

const emptyTripDraft: TripDraft = { name: '', regionId: '', startDate: '', endDate: '' }

function localDateString(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toTripDraft(trip: Trip): TripDraft {
  return {
    name: trip.name,
    regionId: trip.regionId,
    startDate: trip.startDate,
    endDate: trip.endDate,
  }
}

function toItemDraft(item: ItineraryItem): ItemDraft {
  return {
    placeId: item.placeId,
    date: item.date,
    arrivalTime: item.arrivalTime ?? '',
    durationMinutes: item.durationMinutes === undefined ? '' : String(item.durationMinutes),
    transport: item.transport ?? '',
    note: item.note ?? '',
  }
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('zh-TW', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`))
}

function ItineraryModule() {
  const [trips, setTrips] = useState<Trip[]>([])
  const [regions, setRegions] = useState<Region[]>([])
  const [places, setPlaces] = useState<Place[]>([])
  const [items, setItems] = useState<ItineraryItem[]>([])
  const [selectedTripId, setSelectedTripId] = useState<string>()
  const [selectedDate, setSelectedDate] = useState('')
  const [tripDraft, setTripDraft] = useState<TripDraft>(emptyTripDraft)
  const [itemDraft, setItemDraft] = useState<ItemDraft>({
    placeId: '',
    date: '',
    arrivalTime: '',
    durationMinutes: '',
    transport: '',
    note: '',
  })
  const [creatingTrip, setCreatingTrip] = useState(false)
  const [editingTrip, setEditingTrip] = useState(false)
  const [editingItemId, setEditingItemId] = useState<string>()
  const [addingItem, setAddingItem] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const selectedTrip = trips.find((trip) => trip.id === selectedTripId)
  const selectedRegion = regions.find((region) => region.id === selectedTrip?.regionId)
  const tripItems = useMemo(
    () => items.filter((item) => item.tripId === selectedTripId),
    [items, selectedTripId],
  )
  const dayItems = useMemo(
    () => tripItems.filter((item) => item.date === selectedDate)
      .sort((left, right) => left.order - right.order),
    [tripItems, selectedDate],
  )
  const tripPlaces = useMemo(
    () => places.filter((place) => selectedTrip && place.regionIds.includes(selectedTrip.regionId)),
    [places, selectedTrip],
  )
  const dayNumber = selectedTrip && selectedDate
    ? Math.floor((Date.parse(`${selectedDate}T00:00:00Z`) - Date.parse(`${selectedTrip.startDate}T00:00:00Z`)) / 86_400_000) + 1
    : 0
  const totalDays = selectedTrip
    ? Math.floor((Date.parse(`${selectedTrip.endDate}T00:00:00Z`) - Date.parse(`${selectedTrip.startDate}T00:00:00Z`)) / 86_400_000) + 1
    : 0

  async function refreshWorkspace(preferredTripId = selectedTripId) {
    const workspace = await itineraryController.loadWorkspace()
    setTrips(workspace.trips)
    setRegions(workspace.regions)
    setPlaces(workspace.places)
    const nextTrip = workspace.trips.find((trip) => trip.id === preferredTripId) ?? workspace.trips[0]
    setSelectedTripId(nextTrip?.id)
    if (nextTrip) {
      setTripDraft(toTripDraft(nextTrip))
      setSelectedDate((current) =>
        current >= nextTrip.startDate && current <= nextTrip.endDate
          ? current
          : nextTrip.startDate,
      )
    } else {
      setItems([])
      setSelectedDate('')
    }
  }

  useEffect(() => {
    let active = true
    itineraryController.loadWorkspace()
      .then((workspace) => {
        if (!active) return
        setTrips(workspace.trips)
        setRegions(workspace.regions)
        setPlaces(workspace.places)
        const firstTrip = workspace.trips[0]
        setSelectedTripId(firstTrip?.id)
        setTripDraft(firstTrip ? toTripDraft(firstTrip) : emptyTripDraft)
        setSelectedDate(firstTrip?.startDate ?? '')
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : '載入行程資料失敗。')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!selectedTripId) {
      return
    }
    let active = true
    itineraryController.listItems(selectedTripId)
      .then((nextItems) => {
        if (active) setItems(nextItems)
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : '載入每日行程失敗。')
      })
    return () => {
      active = false
    }
  }, [selectedTripId])

  function selectTrip(trip: Trip) {
    setSelectedTripId(trip.id)
    setSelectedDate(trip.startDate)
    setTripDraft(toTripDraft(trip))
    setCreatingTrip(false)
    setEditingTrip(false)
    setAddingItem(false)
    setEditingItemId(undefined)
    setError('')
    setNotice('')
  }

  function startCreateTrip() {
    const firstRegion = regions[0]
    const today = localDateString()
    setSelectedTripId(undefined)
    setTripDraft({
      name: '',
      regionId: firstRegion?.id ?? '',
      startDate: today,
      endDate: today,
    })
    setCreatingTrip(true)
    setEditingTrip(true)
    setAddingItem(false)
    setEditingItemId(undefined)
    setError('')
    setNotice('')
  }

  function startEditTrip() {
    if (!selectedTrip) return
    setTripDraft(toTripDraft(selectedTrip))
    setEditingTrip(true)
    setCreatingTrip(false)
    setAddingItem(false)
    setEditingItemId(undefined)
    setError('')
    setNotice('')
  }

  function cancelTripEdit() {
    setEditingTrip(false)
    setCreatingTrip(false)
    setError('')
    setTripDraft(selectedTrip ? toTripDraft(selectedTrip) : emptyTripDraft)
  }

  async function handleTripSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    const input: NewTrip = {
      name: tripDraft.name.trim(),
      regionId: tripDraft.regionId,
      startDate: tripDraft.startDate,
      endDate: tripDraft.endDate,
    }
    try {
      const id = creatingTrip
        ? await itineraryController.createTrip(input)
        : selectedTripId
          ? (await itineraryController.updateTrip(selectedTripId, input), selectedTripId)
          : undefined
      await refreshWorkspace(id)
      setCreatingTrip(false)
      setEditingTrip(false)
      setNotice(creatingTrip ? '行程已建立。' : '行程變更已儲存。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '儲存行程失敗。')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteTrip() {
    if (!selectedTrip || !window.confirm(`確定要刪除行程「${selectedTrip.name}」嗎？`)) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await itineraryController.deleteTrip(selectedTrip.id)
      await refreshWorkspace()
      setNotice(`行程「${selectedTrip.name}」已刪除。`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '刪除行程失敗。')
    } finally {
      setSaving(false)
    }
  }

  function startAddItem() {
    setItemDraft({
      placeId: tripPlaces[0]?.id ?? '',
      date: selectedDate,
      arrivalTime: '',
      durationMinutes: '',
      transport: '',
      note: '',
    })
    setAddingItem(true)
    setEditingItemId(undefined)
    setEditingTrip(false)
    setError('')
    setNotice('')
  }

  function startEditItem(item: ItineraryItem) {
    setItemDraft(toItemDraft(item))
    setEditingItemId(item.id)
    setAddingItem(false)
    setError('')
    setNotice('')
  }

  function cancelItemEdit() {
    setAddingItem(false)
    setEditingItemId(undefined)
    setError('')
  }

  async function handleItemSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedTripId) return
    setSaving(true)
    setError('')
    setNotice('')
    const changes = {
      placeId: itemDraft.placeId,
      date: itemDraft.date,
      ...(itemDraft.arrivalTime ? { arrivalTime: itemDraft.arrivalTime } : { arrivalTime: undefined }),
      ...(itemDraft.durationMinutes ? { durationMinutes: Number(itemDraft.durationMinutes) } : { durationMinutes: undefined }),
      ...(itemDraft.transport.trim() ? { transport: itemDraft.transport.trim() } : { transport: undefined }),
      ...(itemDraft.note.trim() ? { note: itemDraft.note.trim() } : { note: undefined }),
    }
    try {
      if (editingItemId) {
        const oldItem = items.find((item) => item.id === editingItemId)
        await itineraryController.updateItem(editingItemId, {
          ...changes,
          ...(oldItem?.date !== itemDraft.date
            ? {
                order: tripItems
                  .filter((item) => item.date === itemDraft.date)
                  .reduce((maximum, item) => Math.max(maximum, item.order), -1) + 1,
              }
            : {}),
        })
      } else {
        await itineraryController.addItem({ tripId: selectedTripId, ...changes })
      }
      setItems(await itineraryController.listItems(selectedTripId))
      setSelectedDate(itemDraft.date)
      setAddingItem(false)
      setEditingItemId(undefined)
      setNotice(editingItemId ? '行程項目已更新。' : '地點已加入每日行程。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '儲存行程項目失敗。')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteItem(item: ItineraryItem) {
    const placeName = places.find((place) => place.id === item.placeId)?.name ?? '此地點'
    if (!window.confirm(`確定要從行程中移除「${placeName}」嗎？`)) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await itineraryController.deleteItem(item.id)
      setItems(await itineraryController.listItems(item.tripId))
      setNotice(`已從行程移除「${placeName}」。`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '移除行程項目失敗。')
    } finally {
      setSaving(false)
    }
  }

  async function moveItem(item: ItineraryItem, direction: -1 | 1) {
    const index = dayItems.findIndex((candidate) => candidate.id === item.id)
    const targetIndex = index + direction
    if (index < 0 || targetIndex < 0 || targetIndex >= dayItems.length) return
    const orderedIds = dayItems.map((candidate) => candidate.id)
    ;[orderedIds[index], orderedIds[targetIndex]] = [orderedIds[targetIndex], orderedIds[index]]
    setSaving(true)
    setError('')
    try {
      await itineraryController.reorderItems(item.tripId, selectedDate, orderedIds)
      setItems(await itineraryController.listItems(item.tripId))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '調整地點順序失敗。')
    } finally {
      setSaving(false)
    }
  }

  const activeItemId = editingItemId
  const itemFormVisible = addingItem || activeItemId !== undefined

  return (
    <div className="itinerary-app-shell">
      <aside className="itinerary-sidebar">
        <RouterLink className="itinerary-brand" to={routes.labels}>
          <span className="itinerary-brand-mark">漫</span>
          <span><strong>漫遊手帳</strong><small>TRAVEL PLANNER</small></span>
        </RouterLink>
        <div className="itinerary-nav-caption">工作區</div>
        <nav className="itinerary-nav" aria-label="主要導覽">
          <RouterLink to={routes.places}>⌖ <span>地點</span></RouterLink>
          <RouterLink to={routes.itinerary} aria-current="page">▤ <span>行程</span></RouterLink>
          <RouterLink to={routes.regions}>◎ <span>區域管理</span></RouterLink>
          <RouterLink to={routes.labels}>◈ <span>標籤管理</span></RouterLink>
        </nav>
        <div className="itinerary-sidebar-foot">資料儲存於此瀏覽器</div>
      </aside>

      <main className="itinerary-main">
        <header className="itinerary-topbar"><span>工作區　/　行程規劃</span><span>本機資料</span></header>
        <div className="itinerary-content">
          <section className="itinerary-heading">
            <div><div className="itinerary-eyebrow">把收藏的地點排進旅行</div><h1>行程規劃</h1><p>建立旅行日期，再按天安排地點、時間與備註。</p></div>
            <button type="button" className="itinerary-primary" onClick={startCreateTrip}>＋ 新增行程</button>
          </section>
          {error && <div className="itinerary-feedback itinerary-error" role="alert">{error}</div>}
          {notice && <div className="itinerary-feedback itinerary-success" role="status">{notice}</div>}

          <section className="itinerary-workspace">
            <aside className="itinerary-trips-card">
              <div className="itinerary-card-heading"><div><strong>我的行程</strong><small>{trips.length} 個行程</small></div></div>
              {loading ? <p className="itinerary-empty">正在載入行程…</p> : trips.length ? trips.map((trip) => (
                <button
                  type="button"
                  key={trip.id}
                  className={`itinerary-trip-row${trip.id === selectedTripId && !creatingTrip ? ' selected' : ''}`}
                  onClick={() => selectTrip(trip)}
                >
                  <span className="itinerary-trip-icon">▤</span>
                  <span><strong>{trip.name}</strong><small>{trip.startDate} — {trip.endDate}</small></span>
                </button>
              )) : <p className="itinerary-empty">還沒有行程，先建立一個吧。</p>}
            </aside>

            <section className="itinerary-plan-card">
              {editingTrip ? (
                <form className="itinerary-trip-form" onSubmit={(event) => void handleTripSubmit(event)}>
                  <div className="itinerary-detail-heading"><div><span>{creatingTrip ? '開始一趟新旅行' : '調整行程設定'}</span><h2>{creatingTrip ? '新增行程' : '編輯行程'}</h2></div></div>
                  {regions.length ? (
                    <>
                      <label className="itinerary-field itinerary-field-wide"><span>行程名稱 <b>*</b></span><input autoFocus value={tripDraft.name} onChange={(event) => setTripDraft({ ...tripDraft, name: event.target.value })} maxLength={100} placeholder="例如：京都慢遊" required disabled={saving} /></label>
                      <label className="itinerary-field itinerary-field-wide"><span>所屬區域 <b>*</b></span><select value={tripDraft.regionId} onChange={(event) => setTripDraft({ ...tripDraft, regionId: event.target.value })} required disabled={saving}><option value="" disabled>選擇區域</option>{regions.map((region) => <option value={region.id} key={region.id}>{region.name}</option>)}</select></label>
                      <div className="itinerary-field-grid">
                        <label className="itinerary-field"><span>開始日期 <b>*</b></span><input type="date" value={tripDraft.startDate} onChange={(event) => setTripDraft({ ...tripDraft, startDate: event.target.value })} required disabled={saving} /></label>
                        <label className="itinerary-field"><span>結束日期 <b>*</b></span><input type="date" min={tripDraft.startDate} value={tripDraft.endDate} onChange={(event) => setTripDraft({ ...tripDraft, endDate: event.target.value })} required disabled={saving} /></label>
                      </div>
                      <div className="itinerary-form-actions"><button type="button" className="itinerary-secondary" disabled={saving} onClick={cancelTripEdit}>取消</button><button type="submit" className="itinerary-primary" disabled={saving || !tripDraft.name.trim()}>{saving ? '儲存中…' : creatingTrip ? '建立行程' : '儲存變更'}</button></div>
                    </>
                  ) : (
                    <div className="itinerary-no-regions">
                      <strong>建立行程前，需要先有一個區域。</strong>
                      <p>區域可代表城市或旅行目的地；建立後即可選擇它來建立行程。</p>
                      <RouterLink className="itinerary-primary itinerary-link-button" to={routes.regions}>前往區域管理</RouterLink>
                      <button type="button" className="itinerary-secondary" onClick={cancelTripEdit}>返回</button>
                    </div>
                  )}
                </form>
              ) : selectedTrip ? (
                <>
                  <div className="itinerary-detail-heading">
                    <div><span>{selectedRegion?.name ?? '旅行行程'} · {totalDays} 天</span><h2>{selectedTrip.name}</h2><p>{selectedTrip.startDate} — {selectedTrip.endDate}</p></div>
                    <div className="itinerary-header-actions">
                      <button type="button" className="itinerary-secondary" onClick={startEditTrip}>編輯行程</button>
                      <button type="button" className="itinerary-delete" disabled={saving || tripItems.length > 0} title={tripItems.length ? '請先移除行程中的地點，才能刪除行程。' : undefined} onClick={() => void handleDeleteTrip()}>刪除</button>
                    </div>
                  </div>
                  <div className="itinerary-day-toolbar">
                    <div><span className="itinerary-day-label">第 {dayNumber} 天</span><strong>{formatDate(selectedDate)}</strong></div>
                    <input aria-label="選擇行程日期" type="date" min={selectedTrip.startDate} max={selectedTrip.endDate} value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
                  </div>

                  {itemFormVisible && (
                    <form className="itinerary-item-form" onSubmit={(event) => void handleItemSubmit(event)}>
                      <div className="itinerary-form-title"><strong>{addingItem ? '將地點加入行程' : '編輯每日項目'}</strong><button type="button" aria-label="關閉" onClick={cancelItemEdit}>×</button></div>
                      {tripPlaces.length ? (
                        <>
                          <div className="itinerary-field-grid">
                            <label className="itinerary-field"><span>地點 <b>*</b></span><select value={itemDraft.placeId} onChange={(event) => setItemDraft({ ...itemDraft, placeId: event.target.value })} required disabled={saving}><option value="" disabled>選擇已收藏地點</option>{tripPlaces.map((place) => <option value={place.id} key={place.id}>{place.name}</option>)}</select></label>
                            <label className="itinerary-field"><span>日期 <b>*</b></span><input type="date" min={selectedTrip.startDate} max={selectedTrip.endDate} value={itemDraft.date} onChange={(event) => setItemDraft({ ...itemDraft, date: event.target.value })} required disabled={saving} /></label>
                            <label className="itinerary-field"><span>抵達時間</span><input type="time" value={itemDraft.arrivalTime} onChange={(event) => setItemDraft({ ...itemDraft, arrivalTime: event.target.value })} disabled={saving} /></label>
                            <label className="itinerary-field"><span>停留時間（分鐘）</span><input type="number" min="1" step="1" value={itemDraft.durationMinutes} onChange={(event) => setItemDraft({ ...itemDraft, durationMinutes: event.target.value })} placeholder="例如：90" disabled={saving} /></label>
                            <label className="itinerary-field itinerary-field-wide"><span>交通方式</span><input value={itemDraft.transport} onChange={(event) => setItemDraft({ ...itemDraft, transport: event.target.value })} maxLength={100} placeholder="例如：步行、地鐵" disabled={saving} /></label>
                            <label className="itinerary-field itinerary-field-wide"><span>備註</span><textarea rows={3} value={itemDraft.note} onChange={(event) => setItemDraft({ ...itemDraft, note: event.target.value })} maxLength={1000} placeholder="預約資訊、想做的事…" disabled={saving} /></label>
                          </div>
                          <div className="itinerary-form-actions"><button type="button" className="itinerary-secondary" disabled={saving} onClick={cancelItemEdit}>取消</button><button type="submit" className="itinerary-primary" disabled={saving || !itemDraft.placeId}>{saving ? '儲存中…' : addingItem ? '加入行程' : '儲存項目'}</button></div>
                        </>
                      ) : (
                        <div className="itinerary-no-places"><p>目前沒有歸入「{selectedRegion?.name}」的地點。</p><RouterLink to={routes.places}>前往地點模組，建立地點並設定所屬區域。</RouterLink></div>
                      )}
                    </form>
                  )}

                  <div className="itinerary-items-heading"><div><h3>當日安排</h3><span>{dayItems.length} 個地點</span></div><button type="button" className="itinerary-add-button" disabled={saving || itemFormVisible} onClick={startAddItem}>＋ 加入地點</button></div>
                  {dayItems.length ? (
                    <ol className="itinerary-item-list">
                      {dayItems.map((item, index) => {
                        const place = places.find((candidate) => candidate.id === item.placeId)
                        return (
                          <li className="itinerary-item-row" key={item.id}>
                            <span className="itinerary-order">{String(index + 1).padStart(2, '0')}</span>
                            <div className="itinerary-item-copy">
                              <strong>{place?.name ?? '地點已不存在'}</strong>
                              <div className="itinerary-item-meta">
                                {item.arrivalTime && <span>{item.arrivalTime}</span>}
                                {item.durationMinutes && <span>{item.durationMinutes} 分鐘</span>}
                                {item.transport && <span>{item.transport}</span>}
                              </div>
                              {item.note && <p>{item.note}</p>}
                            </div>
                            <div className="itinerary-item-actions">
                              <button type="button" aria-label="往前移" disabled={saving || index === 0} onClick={() => void moveItem(item, -1)}>↑</button>
                              <button type="button" aria-label="往後移" disabled={saving || index === dayItems.length - 1} onClick={() => void moveItem(item, 1)}>↓</button>
                              <button type="button" aria-label="編輯項目" disabled={saving} onClick={() => startEditItem(item)}>編輯</button>
                              <button type="button" aria-label="移除項目" disabled={saving} onClick={() => void handleDeleteItem(item)}>移除</button>
                            </div>
                          </li>
                        )
                      })}
                    </ol>
                  ) : !itemFormVisible && (
                    <div className="itinerary-day-empty"><span>⌖</span><strong>這一天還沒有安排</strong><p>從已收藏且屬於此區域的地點中加入第一站。</p><button type="button" className="itinerary-primary" disabled={!tripPlaces.length} onClick={startAddItem}>＋ 加入地點</button></div>
                  )}
                  {!tripPlaces.length && !itemFormVisible && <p className="itinerary-region-hint">請先到地點模組，將地點加入「{selectedRegion?.name}」區域。</p>}
                </>
              ) : (
                <div className="itinerary-empty-detail"><span>▤</span><h2>{loading ? '正在載入行程…' : '開始規劃一趟旅行'}</h2><p>{loading ? '' : '新增行程後，即可按天安排收藏的地點。'}</p>{!loading && <button type="button" className="itinerary-primary" onClick={startCreateTrip}>＋ 新增行程</button>}</div>
              )}
            </section>
          </section>
        </div>
      </main>
    </div>
  )
}

export default ItineraryModule
