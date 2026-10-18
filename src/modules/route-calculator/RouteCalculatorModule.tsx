import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Place, Trip } from '../../database'
import { WorkspaceLayout } from '../../common/WorkspaceLayout'
import { SearchableSelect } from '../../common/SearchableSelect'
import { formatTravelDistance, transportOptions } from '../../common/route-estimate'
import { RouterLink } from '../../router'
import { routes } from '../../routes'
import { RouteCalculatorController } from './route-calculator.controller'
import type { RouteCalculationResult, RouteEndpoint, RouteMapPlace, TripMapData } from './route-calculator.service'
import { RouteEndpointField } from './RouteEndpointField'
import { RoutePreviewMap } from './RoutePreviewMap'
import { isTripMarker, markerEndpoint, visibleRouteMarkers } from './route-markers'
import './RouteCalculatorModule.css'

type Target = 'origin' | 'destination'

export default function RouteCalculatorModule() {
  const [controller] = useState(() => new RouteCalculatorController())
  const [places, setPlaces] = useState<Place[]>([])
  const [trips, setTrips] = useState<Trip[]>([])
  const [loading, setLoading] = useState(true)
  const [placesError, setPlacesError] = useState('')
  const [placesAttempt, setPlacesAttempt] = useState(0)
  const [tripsError, setTripsError] = useState('')
  const [tripsAttempt, setTripsAttempt] = useState(0)
  const [tripsLoading, setTripsLoading] = useState(true)
  const [tripId, setTripId] = useState('')
  const [tripData, setTripData] = useState<TripMapData>()
  const [date, setDate] = useState('')
  const [tripLoading, setTripLoading] = useState(false)
  const [tripError, setTripError] = useState('')
  const [personal, setPersonal] = useState<RouteMapPlace[]>([])
  const [hidden, setHidden] = useState<string[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [origin, setOrigin] = useState<RouteEndpoint | null>(null)
  const [destination, setDestination] = useState<RouteEndpoint | null>(null)
  const [originSource, setOriginSource] = useState<RouteEndpoint['source']>('saved')
  const [destinationSource, setDestinationSource] = useState<RouteEndpoint['source']>('saved')
  const [transport, setTransport] = useState('DRIVING')
  const [result, setResult] = useState<RouteCalculationResult>()
  const [calculating, setCalculating] = useState(false)
  const [error, setError] = useState('')
  const [endpointErrors, setEndpointErrors] = useState({ origin: '', destination: '' })
  const [resolving, setResolving] = useState({ origin: false, destination: false })
  const [inputRevision, setInputRevision] = useState({ origin: 0, destination: 0 })
  const generation = useRef(0)
  const endpointGeneration = useRef({ origin: 0, destination: 0 })
  const tripGeneration = useRef(0)
  const configured = controller.isGooglePlacesConfigured()
  const markers = useMemo(() => visibleRouteMarkers(personal, tripData, date, hidden), [personal, tripData, date, hidden])
  const selected = markers.find((marker) => marker.googlePlaceId === selectedId)
  const busy = calculating || tripLoading
  const endpointBusy = busy || resolving.origin || resolving.destination

  const endpointId = (endpoint: RouteEndpoint | null) => !endpoint ? undefined
    : endpoint.source === 'saved' ? places.find((place) => place.id === endpoint.placeId)?.googlePlaceId : endpoint.place.id
  const originId = endpointId(origin)
  const destinationId = endpointId(destination)

  useEffect(() => {
    let active = true
    setLoading(true)
    setPlacesError('')
    void controller.listPlaces().then((records) => {
      if (active) setPlaces(records)
    }).catch((cause: unknown) => {
      if (active) setPlacesError(cause instanceof Error ? cause.message : '載入已存地點失敗。')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [controller, placesAttempt])

  useEffect(() => {
    let active = true
    setTripsLoading(true)
    setTripsError('')
    void controller.listTrips().then((records) => { if (active) setTrips(records) })
      .catch((cause: unknown) => { if (active) setTripsError(cause instanceof Error ? cause.message : '載入行程失敗。') })
      .finally(() => { if (active) setTripsLoading(false) })
    return () => { active = false }
  }, [controller, tripsAttempt])

  useEffect(() => () => {
    generation.current += 1
    endpointGeneration.current.origin += 1
    endpointGeneration.current.destination += 1
    tripGeneration.current += 1
  }, [])

  const invalidate = useCallback(() => {
    generation.current += 1
    setResult(undefined)
    setError('')
    setCalculating(false)
  }, [])

  const changeEndpoint = useCallback((target: Target, value: RouteEndpoint | null) => {
    invalidate()
    const current = ++endpointGeneration.current[target]
    const setter = target === 'origin' ? setOrigin : setDestination
    setter(value)
    setEndpointErrors((errors) => ({ ...errors, [target]: '' }))
    setResolving((state) => ({ ...state, [target]: Boolean(value) }))
    if (!value) return
    void controller.resolveEndpoint(value).then((marker) => {
      if (endpointGeneration.current[target] !== current) return
      setPersonal((existing) => [...existing.filter((item) => item.googlePlaceId !== marker.googlePlaceId), marker])
      setHidden((ids) => ids.filter((id) => id !== marker.googlePlaceId))
      setSelectedId(marker.googlePlaceId)
    }).catch((cause: unknown) => {
      if (endpointGeneration.current[target] !== current) return
      setter(null)
      setEndpointErrors((errors) => ({ ...errors, [target]: cause instanceof Error ? cause.message : '載入地點標記失敗，請重新選擇。' }))
    }).finally(() => {
      if (endpointGeneration.current[target] === current) setResolving((state) => ({ ...state, [target]: false }))
    })
  }, [controller, invalidate])
  const changeOrigin = useCallback((value: RouteEndpoint | null) => changeEndpoint('origin', value), [changeEndpoint])
  const changeDestination = useCallback((value: RouteEndpoint | null) => changeEndpoint('destination', value), [changeEndpoint])

  const removeBinding = useCallback((target: Target) => {
    changeEndpoint(target, null)
    setInputRevision((current) => ({ ...current, [target]: current[target] + 1 }))
  }, [changeEndpoint])

  function changeSource(target: Target, source: RouteEndpoint['source']) {
    if ((target === 'origin' ? originSource : destinationSource) !== source) changeEndpoint(target, null)
    if (target === 'origin') setOriginSource(source)
    else setDestinationSource(source)
  }

  const assignMarker = useCallback((target: Target, marker: RouteMapPlace) => {
    invalidate()
    const isOpposite = target === 'origin'
      ? destinationId === marker.googlePlaceId
      : originId === marker.googlePlaceId
    if (isOpposite) {
      endpointGeneration.current.origin += 1
      endpointGeneration.current.destination += 1
      setResolving({ origin: false, destination: false })
      setEndpointErrors({ origin: '', destination: '' })
      setOrigin(destination)
      setDestination(origin)
      setOriginSource(destinationSource)
      setDestinationSource(originSource)
      setInputRevision((current) => ({ origin: current.origin + 1, destination: current.destination + 1 }))
      setSelectedId(marker.googlePlaceId)
      return
    }
    endpointGeneration.current[target] += 1
    setResolving((state) => ({ ...state, [target]: false }))
    setEndpointErrors((errors) => ({ ...errors, [target]: '' }))
    if (target === 'origin') {
      setOriginSource('google')
      setOrigin(markerEndpoint(marker))
    } else {
      setDestinationSource('google')
      setDestination(markerEndpoint(marker))
    }
    setInputRevision((current) => ({ ...current, [target]: current[target] + 1 }))
    setSelectedId(marker.googlePlaceId)
  }, [invalidate, originId, destinationId, origin, destination, originSource, destinationSource])

  const selectMarker = useCallback((marker: RouteMapPlace) => {
    if (busy) return
    if (selectedId === marker.googlePlaceId) {
      setSelectedId('')
      return
    }
    setSelectedId(marker.googlePlaceId)
  }, [busy, selectedId])

  function reconcileMarkers(next: RouteMapPlace[]) {
    const remains = (id: string | undefined) => !id || next.some((marker) => marker.googlePlaceId === id)
    const clearOrigin = !remains(originId)
    const clearDestination = !remains(destinationId)
    if ((clearOrigin || clearDestination) && !window.confirm('此操作會移除目前的出發點或目的地標記，並清除對應欄位與試算結果。原始資料不受影響。確定繼續？')) return false
    if (clearOrigin) changeOrigin(null)
    if (clearDestination) changeDestination(null)
    if (!next.some((marker) => marker.googlePlaceId === selectedId)) setSelectedId('')
    return true
  }

  async function loadTrip(nextId: string) {
    const current = ++tripGeneration.current
    setTripLoading(true)
    setTripError('')
    try {
      const data = nextId ? await controller.loadTripMarkers(nextId) : undefined
      if (tripGeneration.current !== current) return
      if (!reconcileMarkers(visibleRouteMarkers(personal, data, '', hidden))) return
      setTripId(nextId)
      setTripData(data)
      setDate('')
    } catch (cause) {
      if (tripGeneration.current === current) setTripError(cause instanceof Error ? cause.message : '行程標記載入失敗，請重新選擇行程。')
    } finally {
      if (tripGeneration.current === current) setTripLoading(false)
    }
  }

  function removeMarker(marker: RouteMapPlace) {
    if (isTripMarker(marker.googlePlaceId, tripData)) {
      setError('原行程地點不可移除標記。')
      return
    }
    const nextHidden = [...hidden, marker.googlePlaceId]
    const nextPersonal = personal.filter((item) => item.googlePlaceId !== marker.googlePlaceId)
    if (!reconcileMarkers(visibleRouteMarkers(nextPersonal, tripData, date, nextHidden))) return
    setPersonal(nextPersonal)
    setHidden(nextHidden)
    setSelectedId('')
  }

  async function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || resolving.origin || resolving.destination) return
    if (!origin || !destination) { setError('請選擇有效的出發點與目的地。'); return }
    const current = ++generation.current
    setCalculating(true)
    setResult(undefined)
    setError('')
    try {
      const next = await controller.calculate({ origin, destination, transport })
      if (generation.current === current) setResult(next)
    } catch (cause) {
      if (generation.current === current) setError(cause instanceof Error ? cause.message : '路程計算失敗，請稍後重試。')
    } finally {
      if (generation.current === current) setCalculating(false)
    }
  }

  return (
    <WorkspaceLayout active="route-calculator" mainClassName="route-calculator-main" shellClassName="route-calculator-shell">
      <div className="route-calculator-content">
        <header className="route-calculator-heading">
          <div><h1>路程試算</h1><p>選擇兩個地點與交通方式，即時計算參考時間與距離；標記與試算資料只保留在本頁。</p></div>
          <RouterLink className="route-secondary" to={routes.itinerary}>返回行程</RouterLink>
        </header>
        <div className="route-calculator-workspace">
          <section className="route-calculator-panel" aria-label="路程試算設定與結果">
            <header className="route-panel-heading"><h2>兩點通勤</h2><p>使用已存地點或 Google 搜尋；也可點選地圖圖釘，在標記資訊中指定起終點。</p></header>
            {loading ? <p className="route-loading" role="status">正在載入已存地點…</p> : (
              <form className="route-calculator-form" onSubmit={(event) => void calculate(event)}>
                {placesError && <div className="route-inline-error" role="alert">{placesError} 仍可使用 Google 搜尋。<button type="button" disabled={busy} onClick={() => setPlacesAttempt((value) => value + 1)}>重試載入地點</button></div>}
                <RouteEndpointField key={`origin-${inputRevision.origin}`} controller={controller} label="出發點" places={places} value={origin} onChange={changeOrigin} disabled={busy} autoFocus source={originSource} onSourceChange={(source) => changeSource('origin', source)} />
                {resolving.origin && <p className="route-field-hint" role="status">正在載入出發點標記…</p>}
                {endpointErrors.origin && <p className="route-inline-error" role="alert">{endpointErrors.origin}</p>}
                <RouteEndpointField key={`destination-${inputRevision.destination}`} controller={controller} label="目的地" places={places} value={destination} onChange={changeDestination} disabled={busy} source={destinationSource} onSourceChange={(source) => changeSource('destination', source)} />
                {resolving.destination && <p className="route-field-hint" role="status">正在載入目的地標記…</p>}
                {endpointErrors.destination && <p className="route-inline-error" role="alert">{endpointErrors.destination}</p>}
                <label className="route-transport"><span>交通方式 <b>*</b></span><select value={transport} disabled={busy} onChange={(event) => { invalidate(); setTransport(event.target.value) }}>{transportOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
                {!configured && <p className="route-inline-error" role="alert">尚未設定 Google Maps API key，無法計算路程。</p>}
                {error && <p className="route-inline-error" role="alert">{error}</p>}
                <button className="route-primary" type="submit" disabled={busy || resolving.origin || resolving.destination || !configured || !origin || !destination}>{calculating ? '正在計算…' : '路程計算'}</button>
              </form>
            )}
            {result && <section className="route-result" aria-label="路程試算結果" aria-live="polite">
              <h2>試算結果</h2><p>{result.origin.name} → {result.destination.name}</p>
              <span>{transportOptions.find((option) => option.value === result.transport)?.label}</span>
              <dl><div><dt>預估時間</dt><dd>約 {result.durationMinutes} 分鐘</dd></div><div><dt>路線距離</dt><dd>{formatTravelDistance(result.distanceMeters)}</dd></div></dl>
              <small>Google Maps 路線估算，非保證抵達時間；實際時間受路況與班次影響。修改條件後需重新計算。</small>
            </section>}
            <section className="route-marker-panel" aria-label="標記資訊">
              <h2>標記資訊</h2>
              {selected ? <>
                <p className="route-selected-place">{selected.name}<small>{selected.address}</small></p>
                <p className="route-field-hint">來源：{isTripMarker(selectedId, tripData) ? '原行程地點' : '後加地點（不在所選行程）'}{selectedId === originId ? ' · 出發點' : ''}{selectedId === destinationId ? ' · 目的地' : ''}</p>
                {!isTripMarker(selectedId, tripData) && <div className="route-marker-actions">
                  <button type="button" className="route-remove-marker" disabled={endpointBusy} onClick={() => removeMarker(selected)}>移除標記</button>
                </div>}
              </> : <p className="route-field-hint">點選圖釘或下方清單，可指定端點或移除標記，不會修改原始地點與行程。</p>}
              <details className="route-marker-list"><summary>標記清單（{markers.length}）</summary>
                {markers.length ? <ul>{markers.map((marker) => <li key={marker.googlePlaceId}><button type="button" disabled={busy} aria-pressed={selectedId === marker.googlePlaceId} onClick={() => selectMarker(marker)}>{marker.name}{marker.googlePlaceId === originId ? '（出發點）' : ''}{marker.googlePlaceId === destinationId ? '（目的地）' : ''}</button></li>)}</ul> : <p className="route-field-hint">尚無標記，請載入行程或選取搜尋結果。</p>}
              </details>
            </section>
          </section>
          <RoutePreviewMap markers={markers} tripData={tripData} originId={originId} destinationId={destinationId} selectedId={selectedId} onSelect={selectMarker} disabled={busy} configured={configured} actions={selected && <>
            {selectedId !== originId && <button type="button" className="route-secondary" disabled={endpointBusy} onClick={() => assignMarker('origin', selected)}>設為出發點</button>}
            {selectedId !== destinationId && <button type="button" className="route-secondary" disabled={endpointBusy} onClick={() => assignMarker('destination', selected)}>設為目的地</button>}
            {selectedId === originId && <button type="button" className="route-secondary" disabled={endpointBusy} onClick={() => removeBinding('origin')}>移除出發點</button>}
            {selectedId === destinationId && <button type="button" className="route-secondary" disabled={endpointBusy} onClick={() => removeBinding('destination')}>移除目的地</button>}
          </>} controls={
            <div className="route-trip-controls">
              <div className="route-trip-row">
                <div className="route-trip-field">
                  <label htmlFor="route-trip">載入行程標記</label>
              <SearchableSelect inputId="route-trip" label="載入行程標記" placeholder={tripsLoading ? '正在載入行程…' : '搜尋或選擇行程'} options={[{ id: '', name: '不載入行程' }, ...trips.map((trip) => ({ id: trip.id, name: trip.name }))]} value={tripId} onChange={(id) => void loadTrip(id)} disabled={busy || tripsLoading || resolving.origin || resolving.destination || !configured} />
                </div>
              {tripId && <label className="route-transport"><span>日期範圍</span><select value={date} disabled={busy || resolving.origin || resolving.destination} onChange={(event) => {
                const next = event.target.value
                if (reconcileMarkers(visibleRouteMarkers(personal, tripData, next, hidden))) setDate(next)
              }}><option value="">全部日期</option>{tripData?.dates.map((day) => <option key={day} value={day}>{day}</option>)}</select></label>}
              </div>
              {tripsError && <div className="route-inline-error" role="alert">{tripsError}<button type="button" onClick={() => setTripsAttempt((value) => value + 1)}>重試</button></div>}
              {!tripsLoading && !tripsError && !trips.length && <p className="route-field-hint">尚無行程，仍可搜尋地點加入標記。</p>}
              {tripLoading && <p className="route-field-hint" role="status">正在載入行程地點標記…</p>}
              {tripError && <p className="route-inline-error" role="alert">{tripError} 可重新選擇行程重試。</p>}
              {tripId && !tripData?.dates.length && <p className="route-field-hint">此行程尚未安排地點。</p>}
              {!!tripData?.unavailable.length && <details className="route-unavailable"><summary>{tripData.unavailable.length} 個地點無法顯示</summary><ul>{tripData.unavailable.map((message, index) => <li key={index}>{message}</li>)}</ul></details>}
            </div>
          } />
        </div>
      </div>
    </WorkspaceLayout>
  )
}
