import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Label, NewPlace, Place, PlaceIcon, Region } from '../../database'
import { placeIcons } from '../../database'
import { WorkspaceLayout } from '../../common/WorkspaceLayout'
import { placeController } from './place.controller'
import type { GooglePlaceDetails } from './google-places.service'
import './PlaceModule.css'

interface PlaceDraft {
  name: string
  icon?: PlaceIcon
  mapsUrl: string
  googlePlaceId?: string
  notes: string
  regionIds: string[]
  labelIds: string[]
}

const emptyDraft: PlaceDraft = {
  name: '',
  mapsUrl: '',
  notes: '',
  regionIds: [],
  labelIds: [],
}

function toDraft(place: Place): PlaceDraft {
  return {
    name: place.name,
    icon: place.icon,
    mapsUrl: place.mapsUrl ?? '',
    googlePlaceId: place.googlePlaceId,
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
  const [googleDetails, setGoogleDetails] = useState<GooglePlaceDetails | null>(null)
  const [googleDetailsForId, setGoogleDetailsForId] = useState<string>()
  const [googleDetailsErrorForId, setGoogleDetailsErrorForId] = useState<string>()
  const autocompleteContainerRef = useRef<HTMLDivElement>(null)
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
  const selectedGooglePlaceId = selectedPlace?.googlePlaceId
  const draftGoogleDetails =
    googleDetailsForId === draft.googlePlaceId ? googleDetails : null
  const visibleGoogleDetails =
    googleDetailsForId === selectedGooglePlaceId ? googleDetails : null
  const googleDetailsLoading = Boolean(
    selectedGooglePlaceId &&
    googleDetailsForId !== selectedGooglePlaceId &&
    googleDetailsErrorForId !== selectedGooglePlaceId,
  )
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
    if (!editing || !placeController.isGooglePlacesConfigured()) return
    const container = autocompleteContainerRef.current
    if (!container) return

    let active = true
    let dispose: (() => void) | undefined
    placeController.mountPlaceAutocomplete(
      container,
      (details, query) => {
        if (!active) return
        setGoogleDetails(details)
        setGoogleDetailsForId(details.id)
        setGoogleDetailsErrorForId(undefined)
        setDraft((current) => ({
          ...current,
          name: current.name || query,
          googlePlaceId: details.id,
          mapsUrl: '',
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
          setError(cause instanceof Error ? cause.message : 'Google Places 搜尋無法啟動。')
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
    placeController.getGooglePlaceDetails(selectedGooglePlaceId)
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
          setError(cause instanceof Error ? cause.message : '讀取 Google 地點資料失敗。')
        }
      })

    return () => {
      active = false
    }
  }, [selectedGooglePlaceId])

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
    setGoogleDetails(null)
    setGoogleDetailsForId(undefined)
    setGoogleDetailsErrorForId(undefined)
  }

  function startCreate() {
    setCreating(true)
    setEditing(true)
    setSelectedPlaceId(undefined)
    setDraft(emptyDraft)
    setGoogleDetails(null)
    setGoogleDetailsForId(undefined)
    setGoogleDetailsErrorForId(undefined)
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
    setGoogleDetails(null)
    setGoogleDetailsForId(undefined)
    setGoogleDetailsErrorForId(undefined)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    const input: NewPlace = {
      name: draft.name.trim(),
      ...(draft.icon ? { icon: draft.icon } : {}),
      ...(draft.mapsUrl.trim() ? { mapsUrl: draft.mapsUrl.trim() } : {}),
      ...(draft.googlePlaceId ? { googlePlaceId: draft.googlePlaceId } : {}),
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
    <WorkspaceLayout
      active="places"
      counts={{ places: places.length }}
      shellClassName="app-shell place-app-shell"
      mainClassName="main-content"
    >
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
              <p>搜尋並收藏想去的地點，套用標籤與區域，規劃行程時即可快速挑選。</p>
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
                          <strong>
                            {place.icon && (
                              <span className="place-name-icon" aria-hidden="true">
                                {place.icon}
                              </span>
                            )}
                            {place.name}
                          </strong>
                          <span>
                            {place.googlePlaceId ? 'Google Maps 地點' : '自訂地圖連結'}
                          </span>
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
                      <h2>
                        {!creating && draft.icon && (
                          <span className="place-name-icon" aria-hidden="true">
                            {draft.icon}
                          </span>
                        )}
                        {creating ? '建立地點' : draft.name || '編輯地點'}
                      </h2>
                    </div>
                    <button className="subtle-icon-button" type="button" aria-label="取消編輯" onClick={cancelEditing}>×</button>
                  </div>

                  <div className="place-form-grid">
                    <div className="google-place-search place-name-field">
                      <span className="search-field-label">Google Maps 搜尋</span>
                      {placeController.isGooglePlacesConfigured() ? (
                        <>
                          <div className="google-autocomplete" ref={autocompleteContainerRef} />
                          <small>選擇結果可連結或更換 Google 地點；資料庫只保存 place_id，地點名稱請填寫你自己的名稱。</small>
                        </>
                      ) : (
                        <div className="google-key-help">
                          <strong>尚未設定 Google Places</strong>
                          <span>在專案根目錄建立 .env.local，加入 VITE_GOOGLE_MAPS_API_KEY=你的新金鑰，並重啟開發伺服器。</span>
                          <span>Google Cloud 需啟用 Places API (New) 與 Maps JavaScript API。</span>
                        </div>
                      )}
                      {draft.googlePlaceId && (
                        <>
                          <div className="google-selection">
                            {draftGoogleDetails?.displayName && (
                              <strong>{draftGoogleDetails.displayName}</strong>
                            )}
                            {draftGoogleDetails?.formattedAddress ? (
                              <span>{draftGoogleDetails.formattedAddress}</span>
                            ) : (
                              <span>目前已連結 Google Maps 地點。</span>
                            )}
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => {
                                setDraft((current) => ({
                                  ...current,
                                  googlePlaceId: undefined,
                                }))
                              }}
                            >
                              解除 Google 地點連結
                            </button>
                          </div>
                          <div className="google-attribution">Powered by Google Maps</div>
                        </>
                      )}
                    </div>
                    <label className="form-field place-name-field">
                      <span>地點名稱（自行命名） <b>*</b></span>
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

                    <fieldset className="place-icon-field">
                      <legend>地點圖示（選填）</legend>
                      <div className="place-icon-options">
                        <button
                          type="button"
                          className={`place-icon-option place-icon-none${draft.icon ? '' : ' selected'}`}
                          aria-pressed={!draft.icon}
                          onClick={() => setDraft({ ...draft, icon: undefined })}
                          disabled={formDisabled}
                        >
                          無
                        </button>
                        {placeIcons.map((icon) => (
                          <button
                            type="button"
                            className={`place-icon-option${draft.icon === icon ? ' selected' : ''}`}
                            key={icon}
                            aria-label={`選擇圖示 ${icon}`}
                            aria-pressed={draft.icon === icon}
                            onClick={() => setDraft({ ...draft, icon })}
                            disabled={formDisabled}
                          >
                            {icon}
                          </button>
                        ))}
                      </div>
                    </fieldset>

                    {!draft.googlePlaceId ? (
                      <label className="form-field place-url-field">
                        <span>地圖網址 {!draft.googlePlaceId && <b>*</b>}</span>
                        <input
                          type="url"
                          value={draft.mapsUrl}
                          onChange={(event) => setDraft({ ...draft, mapsUrl: event.target.value })}
                          placeholder="https://maps.google.com/..."
                          required={!draft.googlePlaceId}
                          disabled={formDisabled}
                        />
                        <small>若未選 Google 搜尋結果，請貼上 Google Maps 分享連結或其他地圖網址。</small>
                      </label>
                    ) : (
                      <p className="place-url-note">已連結 Google 地點，地圖連結會即時取得，無需另外填寫網址。</p>
                    )}

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
                      <h2>
                        {selectedPlace.icon && (
                          <span className="place-name-icon" aria-hidden="true">
                            {selectedPlace.icon}
                          </span>
                        )}
                        {selectedPlace.name}
                      </h2>
                    </div>
                    <button className="primary-button small-action-button" type="button" onClick={startEditing}>
                      編輯資料
                    </button>
                  </div>

                  {selectedPlace.googlePlaceId && (
                    <section className="google-place-summary">
                      <div className="google-live-heading">Google Maps 地點 <span>Powered by Google Maps</span></div>
                      {googleDetailsLoading ? (
                        <p>正在向 Google 讀取最新地點資訊…</p>
                      ) : visibleGoogleDetails ? (
                        <>
                          {visibleGoogleDetails.displayName && <strong>{visibleGoogleDetails.displayName}</strong>}
                          {visibleGoogleDetails.formattedAddress && <p>{visibleGoogleDetails.formattedAddress}</p>}
                        </>
                      ) : (
                        <p>暫時無法載入即時資料；place_id 仍已保存，請確認網路與 API 設定。</p>
                      )}
                      <a
                        className="maps-link"
                        href={
                          visibleGoogleDetails?.googleMapsUri ??
                          `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedPlace.name)}&query_place_id=${encodeURIComponent(selectedPlace.googlePlaceId)}`
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        在 Google Maps 開啟 ↗
                      </a>
                    </section>
                  )}

                  {!selectedPlace.googlePlaceId && (
                    <div className="place-map-card">
                      <span>自訂地圖位置</span>
                      {selectedPlace.mapsUrl && (
                        <a className="maps-link" href={selectedPlace.mapsUrl} target="_blank" rel="noreferrer">
                          開啟地圖連結 ↗
                        </a>
                      )}
                    </div>
                  )}

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
    </WorkspaceLayout>
  )
}

export default PlaceModule
