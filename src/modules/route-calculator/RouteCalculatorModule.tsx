import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Place } from '../../database'
import { WorkspaceLayout } from '../../common/WorkspaceLayout'
import { formatTravelDistance, transportOptions } from '../../common/route-estimate'
import { RouterLink } from '../../router'
import { routes } from '../../routes'
import { mountGoogleMap } from '../place/google-places.service'
import { routeCalculatorController } from './route-calculator.controller'
import type { RouteCalculationResult, RouteEndpoint } from './route-calculator.service'
import { RouteEndpointField } from './RouteEndpointField'
import './RouteCalculatorModule.css'

export default function RouteCalculatorModule() {
  const [places, setPlaces] = useState<Place[]>([])
  const [loading, setLoading] = useState(true)
  const [placesError, setPlacesError] = useState('')
  const [placesAttempt, setPlacesAttempt] = useState(0)
  const [origin, setOrigin] = useState<RouteEndpoint | null>(null)
  const [destination, setDestination] = useState<RouteEndpoint | null>(null)
  const [transport, setTransport] = useState('DRIVING')
  const [result, setResult] = useState<RouteCalculationResult>()
  const [calculating, setCalculating] = useState(false)
  const [error, setError] = useState('')
  const [mapError, setMapError] = useState('')
  const [mapLoading, setMapLoading] = useState(false)
  const [mapAttempt, setMapAttempt] = useState(0)
  const mapContainer = useRef<HTMLDivElement>(null)
  const generation = useRef(0)
  const configured = routeCalculatorController.isGooglePlacesConfigured()

  useEffect(() => {
    let active = true
    setLoading(true)
    setPlacesError('')
    void routeCalculatorController.listPlaces().then((records) => {
      if (active) setPlaces(records)
    }).catch((cause: unknown) => {
      if (active) setPlacesError(cause instanceof Error ? cause.message : '載入已存地點失敗。')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [placesAttempt])

  useEffect(() => () => { generation.current += 1 }, [])

  const invalidate = useCallback(() => {
    generation.current += 1
    setResult(undefined)
    setError('')
    setMapError('')
    setCalculating(false)
  }, [])
  const changeOrigin = useCallback((value: RouteEndpoint | null) => {
    invalidate(); setOrigin(value)
  }, [invalidate])
  const changeDestination = useCallback((value: RouteEndpoint | null) => {
    invalidate(); setDestination(value)
  }, [invalidate])

  useEffect(() => {
    if (!result || !mapContainer.current) return
    let active = true
    let destroy: (() => void) | undefined
    setMapLoading(true)
    setMapError('')
    const host = document.createElement('div')
    host.className = 'route-map-host'
    mapContainer.current.replaceChildren(host)
    void mountGoogleMap(host, { center: result.origin.position, zoom: 12, maxZoom: 17 })
      .then((map) => {
        if (!active) { map.destroy(); return }
        destroy = () => map.destroy()
        map.setMarkers([
          { id: 'origin', title: `出發點：${result.origin.name}`, position: result.origin.position, sequence: 1 },
          { id: 'destination', title: `目的地：${result.destination.name}`, position: result.destination.position, sequence: 2 },
        ], { fitBounds: true })
        setMapLoading(false)
      }).catch((cause: unknown) => {
        if (active) {
          setMapLoading(false)
          setMapError(cause instanceof Error ? cause.message : '地圖載入失敗。')
        }
      })
    return () => { active = false; destroy?.(); host.remove() }
  }, [result, mapAttempt])

  async function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (calculating) return
    if (!origin || !destination) {
      setError('請選擇有效的出發點與目的地。')
      return
    }
    const current = ++generation.current
    setCalculating(true)
    setResult(undefined)
    setError('')
    setMapError('')
    try {
      const next = await routeCalculatorController.calculate({ origin, destination, transport })
      if (generation.current === current) setResult(next)
    } catch (cause) {
      if (generation.current === current) {
        setError(cause instanceof Error ? cause.message : '路程計算失敗，請稍後重試。')
      }
    } finally {
      if (generation.current === current) setCalculating(false)
    }
  }

  return (
    <WorkspaceLayout active="route-calculator" mainClassName="route-calculator-main" shellClassName="route-calculator-shell">
      <div className="route-calculator-content">
        <header className="route-calculator-heading">
          <div>
            <h1>路程試算</h1>
            <p>選擇兩個地點與交通方式，即時計算參考時間與距離，不儲存試算資料。</p>
          </div>
          <RouterLink className="route-secondary" to={routes.itinerary}>返回行程</RouterLink>
        </header>
        <div className="route-calculator-workspace">
          <section className="route-calculator-panel" aria-label="路程試算設定與結果">
            <header className="route-panel-heading">
              <h2>兩點通勤</h2>
              <p>兩端可分別使用已存地點或 Google 搜尋，不限行程所屬區域。</p>
            </header>
            {loading ? <p className="route-loading" role="status">正在載入已存地點…</p> : (
              <form className="route-calculator-form" onSubmit={(event) => void calculate(event)}>
                {placesError && <div className="route-inline-error" role="alert">
                  {placesError} 仍可使用 Google 搜尋。
                  <button type="button" disabled={calculating} onClick={() => setPlacesAttempt((current) => current + 1)}>重試載入地點</button>
                </div>}
                <RouteEndpointField label="出發點" places={places} value={origin} onChange={changeOrigin} disabled={calculating} autoFocus />
                <RouteEndpointField label="目的地" places={places} value={destination} onChange={changeDestination} disabled={calculating} />
                <label className="route-transport">
                  <span>交通方式 <b>*</b></span>
                  <select value={transport} disabled={calculating} onChange={(event) => { invalidate(); setTransport(event.target.value) }}>
                    {transportOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                  </select>
                </label>
                {!configured && <p className="route-inline-error" role="alert">尚未設定 Google Maps API key，無法計算路程。</p>}
                {error && <p className="route-inline-error" role="alert">{error}</p>}
                <button className="route-primary" type="submit" disabled={calculating || !configured || !origin || !destination}>
                  {calculating ? '正在計算…' : '路程計算'}
                </button>
              </form>
            )}
            {result && (
              <section className="route-result" aria-label="路程試算結果" aria-live="polite">
                <h2>試算結果</h2>
                <p>{result.origin.name} → {result.destination.name}</p>
                <span>{transportOptions.find((option) => option.value === result.transport)?.label}</span>
                <dl>
                  <div><dt>預估時間</dt><dd>約 {result.durationMinutes} 分鐘</dd></div>
                  <div><dt>路線距離</dt><dd>{formatTravelDistance(result.distanceMeters)}</dd></div>
                </dl>
                <small>Google Maps 路線估算，非保證抵達時間；實際時間受路況與班次影響。修改條件後需重新計算。</small>
              </section>
            )}
          </section>
          <section className="route-calculator-map" aria-label="兩點路程地圖" aria-busy={mapLoading && Boolean(result)}>
            <header className="route-panel-heading"><h2>地圖預覽</h2><p>1 出發點 · 2 目的地</p></header>
            <div className="route-map-body">
              <div className="route-map-canvas" ref={mapContainer} />
              {(!result || mapLoading || mapError) && (
                <div className="route-map-message" role={mapError ? 'alert' : 'status'}>
                  {mapError || (result ? '正在載入地圖…' : calculating ? '正在計算路程…' : '選擇地點並按「路程計算」，即可在地圖查看兩個位置。')}
                  {mapError && <button className="route-secondary" type="button" onClick={() => setMapAttempt((current) => current + 1)}>重試地圖</button>}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </WorkspaceLayout>
  )
}
