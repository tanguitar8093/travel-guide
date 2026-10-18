import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { mountGoogleMap } from '../place/google-places.service'
import type { GoogleMapHandle } from '../place/google-places.service'
import type { RouteMapPlace, TripMapData } from './route-calculator.service'
import { isTripMarker, routeMarkerColors } from './route-markers'

interface Props {
  markers: RouteMapPlace[]
  originId?: string
  destinationId?: string
  selectedId: string
  onSelect: (marker: RouteMapPlace) => void
  disabled: boolean
  configured: boolean
  actions: ReactNode
  tripData?: TripMapData
}

export function RoutePreviewMap({
  markers, originId, destinationId, selectedId, onSelect, disabled, configured, actions, tripData,
}: Props) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<GoogleMapHandle | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [fit, setFit] = useState(0)
  const lastFit = useRef(-1)
  const previousIds = useRef('')

  useEffect(() => {
    if (!container.current || !configured) return
    let active = true
    setReady(false)
    setError('')
    const host = document.createElement('div')
    host.className = 'route-map-host'
    container.current.replaceChildren(host)
    void mountGoogleMap(host, { center: { lat: 25.033, lng: 121.5654 }, zoom: 10, maxZoom: 17 })
      .then((handle) => {
        if (!active) { handle.destroy(); return }
        map.current = handle
        previousIds.current = ''
        lastFit.current = -1
        setReady(true)
      }).catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : '地圖載入失敗。')
      })
    return () => { active = false; map.current?.destroy(); map.current = null; host.remove() }
  }, [configured, attempt])

  useEffect(() => {
    if (!ready || !map.current) return
    const ids = markers.map((marker) => marker.googlePlaceId).sort().join('|')
    const shouldFit = ids !== previousIds.current || fit !== lastFit.current
    map.current.setMarkers(markers.map((marker) => ({
      id: marker.googlePlaceId,
      position: marker.position,
      title: `${marker.name}（${isTripMarker(marker.googlePlaceId, tripData) ? '原行程地點' : '後加地點'}）${marker.googlePlaceId === originId ? '（出發點）' : ''}${marker.googlePlaceId === destinationId ? '（目的地）' : ''}${marker.googlePlaceId === selectedId ? '（已選取）' : ''}`,
      color: isTripMarker(marker.googlePlaceId, tripData) ? routeMarkerColors.trip : routeMarkerColors.added,
      enlarged: marker.googlePlaceId === selectedId,
      sequence: marker.googlePlaceId === originId ? 1 : marker.googlePlaceId === destinationId ? 2 : undefined,
      onClick: () => { if (!disabled) onSelect(marker) },
    })), { fitBounds: shouldFit })
    previousIds.current = ids
    lastFit.current = fit
  }, [markers, originId, destinationId, selectedId, onSelect, disabled, ready, fit, tripData])

  return (
    <section className="route-calculator-map" aria-label="路程試算地圖">
      <header className="route-panel-heading">
        <div className="route-map-title"><h2>地圖預覽</h2><div className="route-map-actions">{actions}<button type="button" className="route-secondary route-map-action-button" disabled={!ready || !markers.length} onClick={() => setFit((value) => value + 1)}>顯示全部標記</button></div></div>
      </header>
      <div className="route-map-body">
        <div className="route-map-canvas" ref={container} />
        {(!configured || !ready) && <div className="route-map-message" role={error ? 'alert' : 'status'}>
          {!configured ? '尚未設定 Google Maps API key。' : error || '正在載入地圖…'}
          {error && <button type="button" className="route-secondary" onClick={() => setAttempt((value) => value + 1)}>重試地圖</button>}
        </div>}
      </div>
      <footer className="route-marker-legend" aria-label="標記圖例與數量">
        <span><i style={{ backgroundColor: routeMarkerColors.trip }} aria-hidden="true" />原行程</span>
        <span><i style={{ backgroundColor: routeMarkerColors.added }} aria-hidden="true" />後加地點</span>
        <span aria-live="polite">{markers.length} 個標記</span>
        <span>1 出發 · 2 目的地</span>
      </footer>
    </section>
  )
}
