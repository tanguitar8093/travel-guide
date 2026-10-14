import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { NewRegion, Region } from '../../database'
import { RouterLink } from '../../router'
import { routes } from '../../routes'
import { regionController } from './region.controller'
import type { GooglePlaceDetails } from '../place/google-places.service'
import './RegionModule.css'

interface RegionDraft {
  name: string
  center?: Region['center']
  googlePlaceId?: string
  zoom: number
}

const emptyDraft: RegionDraft = {
  name: '',
  zoom: 10,
}

function toDraft(region: Region): RegionDraft {
  return {
    name: region.name,
    center: region.center,
    googlePlaceId: region.googlePlaceId,
    zoom: region.zoom,
  }
}

function RegionModule() {
  const [regions, setRegions] = useState<Region[]>([])
  const [usage, setUsage] = useState({ places: new Map<string, number>(), trips: new Map<string, number>() })
  const [selectedId, setSelectedId] = useState<string>()
  const [draft, setDraft] = useState<RegionDraft>(emptyDraft)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [googleDetails, setGoogleDetails] = useState<GooglePlaceDetails>()
  const [googleDetailsForId, setGoogleDetailsForId] = useState<string>()
  const [googleDetailsErrorForId, setGoogleDetailsErrorForId] = useState<string>()
  const autocompleteContainerRef = useRef<HTMLDivElement>(null)

  const selectedRegion = regions.find((region) => region.id === selectedId)
  const selectedGooglePlaceId = selectedRegion?.googlePlaceId
  const visibleGoogleDetails = googleDetailsForId === selectedGooglePlaceId ? googleDetails : undefined
  const googleDetailsLoading = Boolean(
    selectedGooglePlaceId &&
    googleDetailsForId !== selectedGooglePlaceId &&
    googleDetailsErrorForId !== selectedGooglePlaceId,
  )

  async function refresh(preferredId = selectedId) {
    const workspace = await regionController.loadWorkspace()
    const nextRegion = workspace.regions.find((region) => region.id === preferredId) ?? workspace.regions[0]
    setRegions(workspace.regions)
    setUsage({
      places: new Map(workspace.regions.map((region) => [
        region.id,
        workspace.places.filter((place) => place.regionIds.includes(region.id)).length,
      ])),
      trips: new Map(workspace.regions.map((region) => [
        region.id,
        workspace.trips.filter((trip) => trip.regionId === region.id).length,
      ])),
    })
    setSelectedId(nextRegion?.id)
    setDraft(nextRegion ? toDraft(nextRegion) : emptyDraft)
  }

  useEffect(() => {
    let active = true
    regionController.loadWorkspace()
      .then((workspace) => {
        if (!active) return
        setRegions(workspace.regions)
        setUsage({
          places: new Map(workspace.regions.map((region) => [
            region.id,
            workspace.places.filter((place) => place.regionIds.includes(region.id)).length,
          ])),
          trips: new Map(workspace.regions.map((region) => [
            region.id,
            workspace.trips.filter((trip) => trip.regionId === region.id).length,
          ])),
        })
        const firstRegion = workspace.regions[0]
        setSelectedId(firstRegion?.id)
        setDraft(firstRegion ? toDraft(firstRegion) : emptyDraft)
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : '載入區域資料失敗。')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!editing || !regionController.isGooglePlacesConfigured()) return
    const container = autocompleteContainerRef.current
    if (!container) return

    let active = true
    let dispose: (() => void) | undefined
    regionController.mountPlaceAutocomplete(
      container,
      (details, query) => {
        if (!active) return
        setGoogleDetails(details)
        setGoogleDetailsForId(details.id)
        setGoogleDetailsErrorForId(undefined)
        setDraft((current) => ({
          ...current,
          name: current.name || query,
          center: undefined,
          googlePlaceId: details.id,
        }))
        setError('')
      },
      (cause) => {
        if (active) setError(cause.message)
      },
    )
      .then((unmount) => {
        if (active) dispose = unmount
        else unmount()
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Google 地點搜尋無法啟動。')
        }
      })
    return () => {
      active = false
      dispose?.()
      container.replaceChildren()
    }
  }, [editing])

  useEffect(() => {
    if (!selectedGooglePlaceId) return
    let active = true
    regionController.getGooglePlaceDetails(selectedGooglePlaceId)
      .then((details) => {
        if (active) {
          setGoogleDetails(details)
          setGoogleDetailsForId(selectedGooglePlaceId)
          setGoogleDetailsErrorForId(undefined)
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setGoogleDetailsErrorForId(selectedGooglePlaceId)
          setError(cause instanceof Error ? cause.message : '讀取 Google 區域資料失敗。')
        }
      })
    return () => {
      active = false
    }
  }, [selectedGooglePlaceId])

  function startCreate() {
    setSelectedId(undefined)
    setDraft(emptyDraft)
    setGoogleDetails(undefined)
    setGoogleDetailsForId(undefined)
    setGoogleDetailsErrorForId(undefined)
    setCreating(true)
    setEditing(true)
    setError('')
    setNotice('')
  }

  function selectRegion(region: Region) {
    setSelectedId(region.id)
    setDraft(toDraft(region))
    setCreating(false)
    setEditing(false)
    setGoogleDetails(undefined)
    setGoogleDetailsForId(undefined)
    setGoogleDetailsErrorForId(undefined)
    setError('')
    setNotice('')
  }

  function cancelEdit() {
    setCreating(false)
    setEditing(false)
    setError('')
    setDraft(selectedRegion ? toDraft(selectedRegion) : emptyDraft)
    setGoogleDetails(undefined)
    setGoogleDetailsForId(undefined)
    setGoogleDetailsErrorForId(undefined)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    const input: NewRegion = {
      name: draft.name.trim(),
      ...(draft.googlePlaceId
        ? { googlePlaceId: draft.googlePlaceId }
        : draft.center
          ? { center: draft.center }
          : {}),
      zoom: draft.zoom,
    }
    try {
      const id = creating
        ? await regionController.create(input)
        : selectedId
          ? (await regionController.update(selectedId, input), selectedId)
          : undefined
      await refresh(id)
      setCreating(false)
      setEditing(false)
      setNotice(creating ? '區域已建立。' : '區域變更已儲存。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '儲存區域失敗。')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(region: Region) {
    if (!window.confirm(`確定要刪除「${region.name}」嗎？`)) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await regionController.delete(region.id)
      await refresh()
      setNotice(`區域「${region.name}」已刪除。`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '刪除區域失敗。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="region-app-shell">
      <aside className="region-sidebar">
        <RouterLink className="region-brand" to={routes.labels}>
          <span className="region-brand-mark">漫</span>
          <span><strong>漫遊手帳</strong><small>TRAVEL PLANNER</small></span>
        </RouterLink>
        <div className="region-nav-caption">工作區</div>
        <nav className="region-nav" aria-label="主要導覽">
          <RouterLink to={routes.regions} aria-current="page">◎ <span>區域管理</span></RouterLink>
          <RouterLink to={routes.places}>⌖ <span>地點</span></RouterLink>
          <RouterLink to={routes.labels}>◈ <span>標籤管理</span></RouterLink>
          <RouterLink to={routes.itinerary}>▤ <span>行程</span></RouterLink>
          <RouterLink to={routes.dataManagement}>⇅ <span>資料管理</span></RouterLink>
        </nav>
        <div className="region-sidebar-foot">資料儲存於此瀏覽器</div>
      </aside>

      <main className="region-main">
        <header className="region-topbar"><span>工作區　/　區域管理</span><span>本機資料</span></header>
        <div className="region-content">
          <section className="region-heading">
            <div><div className="region-eyebrow">旅行目的地的整理單位</div><h1>區域管理</h1><p>建立行程使用的區域，也可將收藏地點歸入相同區域。</p></div>
            <button type="button" className="region-primary" onClick={startCreate}>＋ 新增區域</button>
          </section>
          {error && <div className="region-feedback region-error" role="alert">{error}</div>}
          {notice && <div className="region-feedback region-success" role="status">{notice}</div>}
          <section className="region-workspace">
            <aside className="region-list-card">
              <div className="region-card-heading"><strong>已建立區域</strong><span>{regions.length}</span></div>
              {loading ? <p className="region-empty">正在載入…</p> : regions.length ? regions.map((region) => (
                <button
                  type="button"
                  key={region.id}
                  className={`region-list-item${selectedId === region.id && !creating ? ' selected' : ''}`}
                  onClick={() => selectRegion(region)}
                >
                  <span className="region-list-icon">◎</span>
                  <span><strong>{region.name}</strong><small>{usage.trips.get(region.id) ?? 0} 個行程 · {usage.places.get(region.id) ?? 0} 個地點</small></span>
                </button>
              )) : <p className="region-empty">目前還沒有區域。</p>}
            </aside>

            <section className="region-detail-card">
              {editing ? (
                <form className="region-form" onSubmit={(event) => void handleSubmit(event)}>
                  <div className="region-detail-heading">
                    <div><span>{creating ? '建立目的地區域' : '編輯區域'}</span><h2>{creating ? '新增區域' : draft.name}</h2></div>
                  </div>
                  <label className="region-field region-field-wide">
                    <span>區域名稱 <b>*</b></span>
                    <input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} maxLength={100} placeholder="例如：京都、大阪" required disabled={saving} />
                  </label>
                  <div className="region-google-search">
                    <div className="region-search-label">用 Google 地圖選擇區域中心 <b>*</b></div>
                    {regionController.isGooglePlacesConfigured() ? (
                      <div className="region-autocomplete" ref={autocompleteContainerRef} />
                    ) : (
                      <div className="region-google-help">
                        <strong>尚未設定 Google Places</strong>
                        <span>請在專案根目錄的 .env.local 設定 VITE_GOOGLE_MAPS_API_KEY，並重啟開發伺服器。</span>
                        <span>Google Cloud 需啟用 Places API (New) 與 Maps JavaScript API。</span>
                      </div>
                    )}
                    {draft.googlePlaceId && (
                      <div className="region-selected-place">
                        <span>✓ 已選擇 Google Maps 地點</span>
                        {googleDetails?.id === draft.googlePlaceId && googleDetails.formattedAddress && (
                          <small>{googleDetails.formattedAddress}</small>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="region-actions">
                    {!creating && selectedRegion && <button type="button" className="region-delete" disabled={saving} onClick={() => void handleDelete(selectedRegion)}>刪除區域</button>}
                    <div><button type="button" className="region-secondary" disabled={saving} onClick={cancelEdit}>取消</button><button type="submit" className="region-primary" disabled={saving || !draft.name.trim() || (!draft.googlePlaceId && !draft.center)}>{saving ? '儲存中…' : creating ? '建立區域' : '儲存變更'}</button></div>
                  </div>
                </form>
              ) : selectedRegion ? (
                <div className="region-detail">
                  <div className="region-detail-heading">
                    <div><span>區域詳細資料</span><h2>{selectedRegion.name}</h2></div>
                    <button type="button" className="region-secondary" onClick={() => setEditing(true)}>編輯資料</button>
                  </div>
                  {selectedRegion.googlePlaceId ? (
                    <section className="region-google-summary">
                      <div className="region-google-attribution">Google Maps 地點 <span>Powered by Google Maps</span></div>
                      {googleDetailsLoading ? (
                        <p>正在向 Google 讀取區域資訊…</p>
                      ) : visibleGoogleDetails ? (
                        <>
                          {visibleGoogleDetails.displayName && <strong>{visibleGoogleDetails.displayName}</strong>}
                          {visibleGoogleDetails.formattedAddress && <p>{visibleGoogleDetails.formattedAddress}</p>}
                        </>
                      ) : (
                        <p>暫時無法載入即時地點資訊；Google place_id 仍已保存。</p>
                      )}
                      <a
                        className="region-map-link"
                        href={
                          visibleGoogleDetails?.googleMapsUri ??
                          `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedRegion.name)}&query_place_id=${encodeURIComponent(selectedRegion.googlePlaceId)}`
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        在 Google Maps 開啟 ↗
                      </a>
                    </section>
                  ) : (
                    <p className="region-legacy-location">此區域沿用舊版手動設定的位置。編輯時可搜尋 Google Maps 更新位置。</p>
                  )}
                  <dl className="region-details-grid">
                    <div><dt>所屬行程</dt><dd>{usage.trips.get(selectedRegion.id) ?? 0} 個</dd></div>
                    <div><dt>收藏地點</dt><dd>{usage.places.get(selectedRegion.id) ?? 0} 個</dd></div>
                  </dl>
                  <p className="region-help">行程建立時需選擇一個區域。若要將地點加入此區域，請到地點模組編輯地點的「所屬區域」。</p>
                </div>
              ) : (
                <div className="region-empty-detail"><span>◎</span><h2>先建立旅行區域</h2><p>區域可以代表城市、地區或一次旅行的目的地範圍。</p><button type="button" className="region-primary" onClick={startCreate}>＋ 新增區域</button></div>
              )}
            </section>
          </section>
        </div>
      </main>
    </div>
  )
}

export default RegionModule
