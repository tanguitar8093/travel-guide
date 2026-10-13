import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { Label, NewPlace, Place, Region } from '../../database'
import { RouterLink } from '../../router'
import { routes } from '../../routes'
import { placeController } from './place.controller'
import './PlaceModule.css'

interface PlaceDraft {
  name: string
  latitude: string
  longitude: string
  mapsUrl: string
  notes: string
  regionIds: string[]
  labelIds: string[]
}

const emptyDraft: PlaceDraft = {
  name: '',
  latitude: '',
  longitude: '',
  mapsUrl: '',
  notes: '',
  regionIds: [],
  labelIds: [],
}

function toDraft(place: Place): PlaceDraft {
  return {
    name: place.name,
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    mapsUrl: place.mapsUrl ?? '',
    notes: place.notes ?? '',
    regionIds: [...place.regionIds],
    labelIds: [...place.labelIds],
  }
}

function flattenLabels(labels: Label[]): Label[] {
  const byParent = new Map<string | undefined, Label[]>()
  for (const label of labels) {
    const children = byParent.get(label.parentId) ?? []
    children.push(label)
    byParent.set(label.parentId, children)
  }
  const ordered: Label[] = []
  const visit = (parentId: string | undefined) => {
    for (const label of byParent.get(parentId) ?? []) {
      ordered.push(label)
      visit(label.id)
    }
  }
  visit(undefined)
  return ordered
}

function labelDepth(label: Label, labels: Label[]): number {
  let depth = 0
  let parentId = label.parentId
  while (parentId) {
    depth += 1
    parentId = labels.find((candidate) => candidate.id === parentId)?.parentId
  }
  return depth
}

function getPlaceInitial(name: string): string {
  return Array.from(name.trim())[0] ?? '地'
}

function PlaceModule() {
  const [places, setPlaces] = useState<Place[]>([])
  const [filteredPlaces, setFilteredPlaces] = useState<Place[]>([])
  const [labels, setLabels] = useState<Label[]>([])
  const [regions, setRegions] = useState<Region[]>([])
  const [selectedPlaceId, setSelectedPlaceId] = useState<string>()
  const [draft, setDraft] = useState<PlaceDraft>(emptyDraft)
  const [filterText, setFilterText] = useState('')
  const [selectedFilterLabelIds, setSelectedFilterLabelIds] = useState<string[]>([])
  const [includeDescendants, setIncludeDescendants] = useState(true)
  const [editing, setEditing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const orderedLabels = useMemo(() => flattenLabels(labels), [labels])
  const selectedPlace = places.find((place) => place.id === selectedPlaceId)
  async function reloadPlaces(preferredId = selectedPlaceId) {
    const [workspace, nextFilteredPlaces] = await Promise.all([
      placeController.loadWorkspace(),
      placeController.search({
        search: filterText,
        labelIds: selectedFilterLabelIds,
        includeDescendants,
      }),
    ])
    setPlaces(workspace.places)
    setLabels(workspace.labels)
    setRegions(workspace.regions)
    setFilteredPlaces(nextFilteredPlaces)

    const nextSelection =
      workspace.places.find((place) => place.id === preferredId) ??
      nextFilteredPlaces[0] ??
      workspace.places[0]
    setSelectedPlaceId(nextSelection?.id)
    if (nextSelection) setDraft(toDraft(nextSelection))
    else setDraft(emptyDraft)
  }

  useEffect(() => {
    let active = true
    Promise.all([
      placeController.loadWorkspace(),
      placeController.search(),
    ])
      .then(([workspace, results]) => {
        if (!active) return
        setPlaces(workspace.places)
        setLabels(workspace.labels)
        setRegions(workspace.regions)
        setFilteredPlaces(results)
        setSelectedPlaceId(results[0]?.id)
        if (results[0]) setDraft(toDraft(results[0]))
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : '載入地點資料失敗。')
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    placeController.search({
      search: filterText,
      labelIds: selectedFilterLabelIds,
      includeDescendants,
    })
      .then((results) => {
        if (!active) return
        setFilteredPlaces(results)
        if (!creating && !editing && selectedPlaceId && !results.some((place) => place.id === selectedPlaceId)) {
          setSelectedPlaceId(results[0]?.id)
          if (results[0]) setDraft(toDraft(results[0]))
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : '搜尋地點失敗。')
        }
      })
    return () => {
      active = false
    }
  }, [filterText, selectedFilterLabelIds, includeDescendants, selectedPlaceId, creating, editing])

  function selectPlace(place: Place) {
    setSelectedPlaceId(place.id)
    setDraft(toDraft(place))
    setEditing(false)
    setCreating(false)
    setError('')
    setNotice('')
  }

  function startCreate() {
    setCreating(true)
    setEditing(true)
    setSelectedPlaceId(undefined)
    setDraft(emptyDraft)
    setFilterText('')
    setSelectedFilterLabelIds([])
    setError('')
    setNotice('')
  }

  function startEditing() {
    if (!selectedPlace) return
    setDraft(toDraft(selectedPlace))
    setEditing(true)
    setCreating(false)
    setError('')
    setNotice('')
  }

  function cancelEditing() {
    setEditing(false)
    setCreating(false)
    setError('')
    if (selectedPlace) setDraft(toDraft(selectedPlace))
    else setDraft(emptyDraft)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    const input: NewPlace = {
      name: draft.name.trim(),
      latitude: Number(draft.latitude),
      longitude: Number(draft.longitude),
      ...(draft.mapsUrl.trim() ? { mapsUrl: draft.mapsUrl.trim() } : {}),
      ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
      regionIds: draft.regionIds,
      labelIds: draft.labelIds,
    }

    try {
      let savedId = selectedPlaceId
      if (creating) {
        savedId = await placeController.create(input)
      } else if (selectedPlaceId) {
        await placeController.update(selectedPlaceId, input)
      }
      await reloadPlaces(savedId)
      setCreating(false)
      setEditing(false)
      setNotice(creating ? '地點已建立。' : '地點變更已儲存。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '儲存地點失敗。')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!selectedPlace) return
    if (!window.confirm(`確定要刪除「${selectedPlace.name}」嗎？`)) return

    setSaving(true)
    setError('')
    setNotice('')
    try {
      await placeController.delete(selectedPlace.id)
      await reloadPlaces()
      setNotice(`地點「${selectedPlace.name}」已刪除。`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '刪除地點失敗。')
    } finally {
      setSaving(false)
    }
  }

  function toggleInDraft(field: 'labelIds' | 'regionIds', id: string) {
    setDraft((current) => ({
      ...current,
      [field]: current[field].includes(id)
        ? current[field].filter((currentId) => currentId !== id)
        : [...current[field], id],
    }))
  }

  function toggleFilterLabel(id: string) {
    setSelectedFilterLabelIds((current) =>
      current.includes(id)
        ? current.filter((currentId) => currentId !== id)
        : [...current, id],
    )
  }

  const formDisabled = !editing || saving

  return (
    <div className="app-shell place-app-shell">
      <aside className="sidebar">
        <RouterLink className="brand" to={routes.labels} aria-label="漫遊手帳首頁">
          <span className="brand-mark">漫</span>
          <span>
            <strong>漫遊手帳</strong>
            <small>TRAVEL PLANNER</small>
          </span>
        </RouterLink>

        <div className="workspace-label">工作區</div>
        <nav className="main-nav" aria-label="主要導覽">
          <a href={routes.places} className="nav-item active" aria-current="page">
            <span className="nav-icon">⌖</span>
            地點
            <span className="nav-count">{places.length}</span>
          </a>
          <a href="#" className="nav-item">
            <span className="nav-icon">▤</span>
            行程
          </a>
          <RouterLink to={routes.labels} className="nav-item">
            <span className="nav-icon">◈</span>
            標籤管理
          </RouterLink>
        </nav>

        <div className="sidebar-bottom">
          <div className="profile-avatar">T</div>
          <div className="profile-copy">
            <strong>我的旅遊空間</strong>
            <small>個人工作區</small>
          </div>
          <span className="profile-menu" aria-hidden="true">···</span>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            <span>工作區</span>
            <span className="breadcrumb-separator">/</span>
            <strong>地點資料庫</strong>
          </div>
          <div className="topbar-actions">
            <span className="prototype-badge">本機資料</span>
            <button className="icon-button" type="button" aria-label="說明" title="資料儲存在此瀏覽器">
              ?
            </button>
            <div className="user-avatar" aria-label="使用者">T</div>
          </div>
        </header>

        <div className="page-content place-page-content">
          <section className="page-heading">
            <div>
              <div className="eyebrow">收藏並整理旅途中想去的地方</div>
              <h1>地點資料庫</h1>
              <p>記錄座標、地圖連結和標籤，規劃行程時即可快速挑選。</p>
            </div>
            <button className="primary-button" type="button" onClick={startCreate}>
              <span aria-hidden="true">＋</span>
              新增地點
            </button>
          </section>

          {error && <div className="feedback-message error-message" role="alert">{error}</div>}
          {notice && <div className="feedback-message success-message" role="status">{notice}</div>}

          <section className="place-workspace">
            <aside className="panel place-browser-panel">
              <div className="panel-heading">
                <div>
                  <h2>已收藏地點</h2>
                  <p>共 {places.length} 個地點</p>
                </div>
              </div>
              <label className="search-box place-search">
                <span aria-hidden="true">⌕</span>
                <input
                  type="search"
                  placeholder="搜尋地點或備註"
                  value={filterText}
                  onChange={(event) => setFilterText(event.target.value)}
                />
                {filterText && (
                  <button type="button" className="clear-search" aria-label="清除搜尋" onClick={() => setFilterText('')}>×</button>
                )}
              </label>

              <div className="place-filter-section">
                <div className="filter-title">依標籤篩選 <span>符合任一標籤</span></div>
                {orderedLabels.length ? (
                  <div className="label-filter-list">
                    {orderedLabels.map((label) => (
                      <label className="label-filter-option" key={label.id}>
                        <input
                          type="checkbox"
                          checked={selectedFilterLabelIds.includes(label.id)}
                          onChange={() => toggleFilterLabel(label.id)}
                        />
                        <span className="filter-color-dot" style={{ backgroundColor: label.color }} />
                        <span>{'　'.repeat(labelDepth(label, labels))}{label.name}</span>
                      </label>
                    ))}
                    <label className="descendant-toggle">
                      <input
                        type="checkbox"
                        checked={includeDescendants}
                        onChange={(event) => setIncludeDescendants(event.target.checked)}
                      />
                      包含所選標籤的子標籤
                    </label>
                  </div>
                ) : (
                  <div className="filter-empty">尚無標籤分類。</div>
                )}
              </div>

              <div className="place-list-heading">
                <span>搜尋結果</span>
                <span>{filteredPlaces.length}</span>
              </div>
              <div className="place-list">
                {loading ? (
                  <div className="empty-state">正在載入地點…</div>
                ) : filteredPlaces.length ? (
                  filteredPlaces.map((place) => {
                    const placeLabels = labels.filter((label) => place.labelIds.includes(label.id))
                    return (
                      <button
                        className={`place-list-item${place.id === selectedPlaceId && !creating ? ' active' : ''}`}
                        type="button"
                        key={place.id}
                        onClick={() => selectPlace(place)}
                      >
                        <span className="place-list-avatar">{getPlaceInitial(place.name)}</span>
                        <span className="place-list-copy">
                          <strong>{place.name}</strong>
                          <span>{place.latitude.toFixed(4)}, {place.longitude.toFixed(4)}</span>
                          <span className="place-list-tags">
                            {placeLabels.slice(0, 3).map((label) => (
                              <i key={label.id} style={{ backgroundColor: label.color }} title={label.name} />
                            ))}
                            {placeLabels.length ? `${placeLabels.length} 個標籤` : '尚無標籤'}
                          </span>
                        </span>
                        <span className="list-chevron">›</span>
                      </button>
                    )
                  })
                ) : (
                  <div className="empty-state">
                    {places.length ? '沒有符合條件的地點。' : '還沒有收藏地點，先新增一個吧。'}
                  </div>
                )}
              </div>
            </aside>

            <section className="panel place-detail-panel">
              {editing ? (
                <form className="place-form" onSubmit={(event) => void handleSubmit(event)}>
                  <div className="place-detail-heading">
                    <div>
                      <div className="section-kicker">{creating ? '新增收藏地點' : '編輯地點資料'}</div>
                      <h2>{creating ? '建立地點' : draft.name || '編輯地點'}</h2>
                    </div>
                    <button className="subtle-icon-button" type="button" aria-label="取消編輯" onClick={cancelEditing}>×</button>
                  </div>

                  <div className="place-form-grid">
                    <label className="form-field place-name-field">
                      <span>地點名稱 <b>*</b></span>
                      <input
                        autoFocus={creating}
                        value={draft.name}
                        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                        maxLength={100}
                        placeholder="例如：首里城"
                        required
                        disabled={formDisabled}
                      />
                    </label>

                    <div className="coordinate-fields">
                      <label className="form-field">
                        <span>緯度 <b>*</b></span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="-90"
                          max="90"
                          step="any"
                          value={draft.latitude}
                          onChange={(event) => setDraft({ ...draft, latitude: event.target.value })}
                          placeholder="26.2171"
                          required
                          disabled={formDisabled}
                        />
                      </label>
                      <label className="form-field">
                        <span>經度 <b>*</b></span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="-180"
                          max="180"
                          step="any"
                          value={draft.longitude}
                          onChange={(event) => setDraft({ ...draft, longitude: event.target.value })}
                          placeholder="127.7195"
                          required
                          disabled={formDisabled}
                        />
                      </label>
                    </div>

                    <label className="form-field place-url-field">
                      <span>Google Maps 網址</span>
                      <input
                        type="url"
                        value={draft.mapsUrl}
                        onChange={(event) => setDraft({ ...draft, mapsUrl: event.target.value })}
                        placeholder="https://maps.google.com/..."
                        disabled={formDisabled}
                      />
                      <small>貼上 Google 地圖分享連結，座標仍以緯度和經度欄位為準。</small>
                    </label>

                    <fieldset className="place-choice-field">
                      <legend>所屬區域</legend>
                      {regions.length ? (
                        <div className="choice-chip-list">
                          {regions.map((region) => (
                            <label className="choice-chip" key={region.id}>
                              <input
                                type="checkbox"
                                checked={draft.regionIds.includes(region.id)}
                                onChange={() => toggleInDraft('regionIds', region.id)}
                                disabled={formDisabled}
                              />
                              {region.name}
                            </label>
                          ))}
                        </div>
                      ) : (
                        <small>目前沒有區域，可先不指定。</small>
                      )}
                    </fieldset>

                    <fieldset className="place-choice-field">
                      <legend>標籤</legend>
                      {orderedLabels.length ? (
                        <div className="choice-chip-list">
                          {orderedLabels.map((label) => (
                            <label className={`choice-chip${draft.labelIds.includes(label.id) ? ' checked' : ''}`} key={label.id}>
                              <input
                                type="checkbox"
                                checked={draft.labelIds.includes(label.id)}
                                onChange={() => toggleInDraft('labelIds', label.id)}
                                disabled={formDisabled}
                              />
                              <span className="filter-color-dot" style={{ backgroundColor: label.color }} />
                              {'　'.repeat(labelDepth(label, labels))}{label.name}
                            </label>
                          ))}
                        </div>
                      ) : (
                        <small>尚無標籤，請先到標籤模組建立分類。</small>
                      )}
                    </fieldset>

                    <label className="form-field place-notes-field">
                      <span>備註</span>
                      <textarea
                        rows={4}
                        value={draft.notes}
                        onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                        placeholder="營業時間、預約方式或想記下的資訊…"
                        disabled={formDisabled}
                      />
                    </label>
                  </div>

                  {error && <div className="form-inline-error" role="alert">{error}</div>}
                  <div className="place-form-actions">
                    {!creating && selectedPlace && (
                      <button className="delete-place-button" type="button" disabled={saving} onClick={() => void handleDelete()}>
                        刪除地點
                      </button>
                    )}
                    <div className="place-form-actions-right">
                      <button className="cancel-button" type="button" disabled={saving} onClick={cancelEditing}>取消</button>
                      <button className="save-button" type="submit" disabled={saving || !draft.name.trim()}>
                        {saving ? '儲存中…' : creating ? '建立地點' : '儲存變更'}
                      </button>
                    </div>
                  </div>
                </form>
              ) : selectedPlace ? (
                <div className="place-readonly">
                  <div className="place-detail-heading">
                    <div>
                      <div className="section-kicker">地點詳細資料</div>
                      <h2>{selectedPlace.name}</h2>
                    </div>
                    <button className="primary-button small-action-button" type="button" onClick={startEditing}>
                      編輯資料
                    </button>
                  </div>

                  <div className="place-map-card">
                    <div className="map-grid" aria-hidden="true" />
                    <div className="map-pin">⌖</div>
                    <div className="map-coordinate">
                      <strong>{selectedPlace.latitude.toFixed(5)}, {selectedPlace.longitude.toFixed(5)}</strong>
                      <span>地點座標</span>
                    </div>
                    {selectedPlace.mapsUrl && (
                      <a className="maps-link" href={selectedPlace.mapsUrl} target="_blank" rel="noreferrer">
                        在 Google Maps 開啟 ↗
                      </a>
                    )}
                  </div>

                  <div className="place-info-grid">
                    <section className="place-info-section">
                      <h3>標籤</h3>
                      {selectedPlace.labelIds.length ? (
                        <div className="place-info-tags">
                          {labels.filter((label) => selectedPlace.labelIds.includes(label.id)).map((label) => (
                            <span className="place-info-tag" key={label.id}>
                              <i style={{ backgroundColor: label.color }} />
                              {label.name}
                            </span>
                          ))}
                        </div>
                      ) : <p className="muted-value">尚未套用標籤</p>}
                    </section>
                    <section className="place-info-section">
                      <h3>所屬區域</h3>
                      {selectedPlace.regionIds.length ? (
                        <div className="place-info-tags">
                          {regions.filter((region) => selectedPlace.regionIds.includes(region.id)).map((region) => (
                            <span className="region-info-tag" key={region.id}>{region.name}</span>
                          ))}
                        </div>
                      ) : <p className="muted-value">尚未指定區域</p>}
                    </section>
                    <section className="place-info-section notes-info-section">
                      <h3>備註</h3>
                      <p className={selectedPlace.notes ? 'place-notes-text' : 'muted-value'}>
                        {selectedPlace.notes || '沒有備註'}
                      </p>
                    </section>
                  </div>
                </div>
              ) : (
                <div className="place-empty-detail">
                  <div className="empty-detail-icon">⌖</div>
                  <h2>{places.length ? '選擇一個地點' : '開始建立你的地點資料庫'}</h2>
                  <p>{places.length ? '從左側選擇地點以查看詳細資料。' : '儲存想去的地點，之後就能快速加入旅行行程。'}</p>
                  {!places.length && (
                    <button className="primary-button" type="button" onClick={startCreate}>＋ 新增地點</button>
                  )}
                </div>
              )}
            </section>
          </section>

          <footer className="page-footer">地點資料儲存於此瀏覽器 <span>•</span> 後續行程模組可直接選用</footer>
        </div>
      </main>
    </div>
  )
}

export default PlaceModule
