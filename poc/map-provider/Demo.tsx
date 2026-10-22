import { useMemo, useRef, useState } from 'react'
import { MapView, createGoogleRenderer, createGoogleSdkLoader, createMapLibreRenderer } from '../../src/geo'
import type { GeoProvider, MapHandle } from '../../src/geo'
import { fixtures, mapOptions } from './fixtures'
import { loadPreviewMapLibre, previewStyle } from './osm-resources'
import './ui.css'

const renderers = {
  google: createGoogleRenderer(createGoogleSdkLoader(import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '')),
  osm: createMapLibreRenderer({ loadSdk: loadPreviewMapLibre, style: previewStyle }),
}

export default function Demo() {
  const [provider, setProvider] = useState<GeoProvider>('osm')
  const [selected, setSelected] = useState<string>()
  const [retry, setRetry] = useState(0)
  const [ready, setReady] = useState(false)
  const map = useRef<MapHandle | null>(null)
  const markers = useMemo(() => fixtures.map(marker => ({ ...marker, selected: selected === marker.id })), [selected])
  const selectedMarker = fixtures.find(marker => marker.id === selected)

  return <main className="core-demo">
    <header><h1>地圖轉換核心 · 隔離 PoC</h1><p>共用圖釘、聚焦與視野方法。不讀寫正式資料，不包含搜尋或路線試算。</p></header>
    <div className="core-controls">
      <label>地圖供應商 <select value={provider} onChange={event => {
        const value = event.target.value
        if (value === 'google' || value === 'osm') {
          map.current = null
          setReady(false)
          setProvider(value)
        }
      }}><option value="google">Google Maps</option><option value="osm">OpenStreetMap (OSM)</option></select></label>
      <button type="button" disabled={!ready} onClick={() => map.current?.fitMarkers()}>全部圖釘</button>
      <button type="button" disabled={!ready} onClick={() => map.current?.fitBounds(mapOptions.bounds!)}>沖繩範圍</button>
      <button type="button" disabled={!ready || !selectedMarker} onClick={() => {
        if (selectedMarker) map.current?.focus(selectedMarker.coordinate, 14)
      }}>聚焦選取</button>
      <button type="button" onClick={() => { map.current = null; setReady(false); setRetry(value => value + 1) }}>重新載入</button>
    </div>
    <p className="core-state" role="status">目前選擇：{provider === 'google' ? 'Google Maps' : 'OpenStreetMap'}；{ready ? '底圖已就緒' : '底圖尚未就緒'}；選取：{selectedMarker?.name ?? '無'}</p>
    <div className="core-workspace">
      <aside aria-label="固定範例圖釘">{markers.map(marker => <button type="button" key={marker.id} aria-pressed={marker.selected} onClick={() => {
        setSelected(marker.id)
        map.current?.focus(marker.coordinate, 14)
      }}><strong>{marker.sequence}. {marker.name}</strong><small>{marker.id}</small></button>)}</aside>
      <div className="core-map">
        <MapView key={`${provider}:${retry}`} renderer={renderers[provider]} options={mapOptions} markers={markers} onSelect={setSelected} onReady={handle => {
          map.current = handle
          setReady(Boolean(handle))
        }} />
      </div>
    </div>
    <p className="core-warning">OSM 使用 maps 專案現有 GeoJSON（約 34 MiB），不是正式圖磚效能方案。Google 僅在選取後載入 SDK，可能產生 Maps API 使用量；缺 key／授權或圖資會明確報錯，不自動換回另一供應商。</p>
    <p className="core-warning">初始 OSM 不呼叫 Google。曾載入 Google 後切回 OSM，SDK 仍可能保留背景連線；需要乾淨 OSM 工作階段時，請重新整理（預設 OSM）。</p>
  </main>
}
