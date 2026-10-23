import { useRef, useEffect, useState } from 'react'
import { setMapProvider, useMapProvider } from '../../geo/provider-preference'
import './MapProviderSettings.css'

function MapIllustration({ osm }: { osm: boolean }) {
  return <div className={`map-illustration${osm ? ' map-illustration-osm' : ''}`}>
    <svg viewBox="0 0 760 390" role="img" aria-label="含道路、公園、水域與地點標記的地圖風格示意">
      <path className="map-water" d="M0 282 C108 253 151 301 239 286 C339 268 377 311 473 288 C566 266 655 285 760 249 L760 390 L0 390 Z" />
      <path className="map-park" d="M44 34 H233 Q251 34 251 52 V126 Q251 144 233 144 H44 Q26 144 26 126 V52 Q26 34 44 34Z" />
      <path className="map-park map-park-small" d="M561 220 H690 Q704 220 704 234 V276 Q704 290 690 290 H561 Q547 290 547 276 V234 Q547 220 561 220Z" />
      <path className="map-road map-road-major" d="M-18 225 C97 187 190 218 297 175 S509 115 778 155" />
      <path className="map-road map-road-major" d="M339 -20 C325 70 359 121 344 201 S314 321 371 415" />
      <path className="map-road" d="M-20 91 C103 111 170 168 273 223 S505 331 774 332" />
      <path className="map-road" d="M88 -10 C124 72 115 137 153 218 S213 325 211 405" />
      <path className="map-road" d="M520 -12 C501 60 539 120 520 183 S493 299 522 403" />
      <path className="map-road" d="M-10 316 C115 278 183 284 290 301 S521 359 766 251" />
      <path className="map-road map-road-local" d="M250 57 L465 57 M264 91 L445 91 M401 43 L401 137 M465 201 L672 201 M465 234 L672 234 M588 174 L588 307 M85 166 L85 265" />
      <g className="map-labels" aria-hidden="true">
        <text x="54" y="77">中央公園</text><text x="75" y="98">CENTRAL PARK</text>
        <text x="376" y="82">中城區</text><text x="580" y="253">河畔綠地</text>
        <text x="112" y="251">文化街區</text><text x="557" y="124">市民廣場</text><text x="560" y="359">海岸步道</text>
      </g>
      <g transform="translate(427 180)">
        <circle className="map-marker-shadow" r="22" />
        <path className="map-marker-pin" d="M0-17 C-10-17-17-9-17 1 C-17 14 0 27 0 27 S17 14 17 1 C17-9 10-17 0-17Z" />
        <circle className="map-marker-dot" r="5" />
      </g>
    </svg>
    <div className="map-zoom-controls" aria-hidden="true"><span>+</span><span>−</span></div>
    <div className="map-preview-label">{osm ? 'osm ‧ 沖繩' : 'Google'} 風格示意</div>
  </div>
}

export function MapProviderSettings() {
  const { provider, error: readError } = useMapProvider()
  const input = useRef<HTMLSelectElement>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => { input.current?.focus() }, [])
  const name = provider === 'osm' ? 'osm ‧ 沖繩' : provider === 'google' ? 'Google Maps' : '尚未選擇'
  return <section className="map-provider-settings settings-card" aria-labelledby="map-settings-heading">
    <div className="settings-card-heading">
      <div className="settings-card-icon" aria-hidden="true">⌖</div>
      <div><h2 id="map-settings-heading">地圖設定</h2><p>選擇你偏好的地圖服務。</p></div>
    </div>
    <div className="provider-setting">
      <label htmlFor="map-provider">地圖供應商</label>
      <select ref={input} id="map-provider" value={provider ?? ''} aria-describedby="map-provider-description" onChange={event => {
        try {
          const value = event.target.value
          if (value !== 'google' && value !== 'osm') throw new Error('請選擇有效的地圖供應商。')
          setMapProvider(value)
          setError('')
          setNotice(`已儲存 ${value === 'osm' ? 'osm ‧ 沖繩' : 'Google Maps'}；重新整理後仍會保留。`)
        } catch (cause) {
          setNotice('')
          setError(cause instanceof Error ? cause.message : '地圖偏好儲存失敗。')
        }
      }}>
        {!provider && <option value="" disabled>請重新選擇</option>}
        <option value="google">Google Maps</option><option value="osm">osm ‧ 沖繩</option>
      </select>
      <p className="provider-description" id="map-provider-description">目前套用於正式行程地圖，依此瀏覽器保存；不切換資料庫來源，也不變更旅行資料。</p>
    </div>
    {(error || readError) && <p className="data-management-feedback data-management-error" role="alert">{error || readError}</p>}
    {notice && <p className="provider-description" role="status">{notice}</p>}
    <div className="provider-preview">
      <div className="provider-preview-heading">
        <div><span className="preview-kicker">互動預覽</span><h3>地圖外觀</h3></div>
        <span className={`provider-pill${provider === 'osm' ? ' provider-pill-osm' : ''}`}><i aria-hidden="true" />{name}</span>
      </div>
      <MapIllustration osm={provider === 'osm'} />
      <p className="illustration-disclaimer">此處為介面風格示意；實際底圖請至行程查看。</p>
    </div>
    <div className="provider-notice" role="note">
      <strong>整合範圍</strong>　OSM 行程地圖不會查 Google 座標；舊 Google-only 地點會列為未定位。
      地點搜尋／新增與路程試算已支援 OSM；OSM 使用固定區域，區域資料僅供檢視。雲端與混合模式的新格式同步仍在整合，地圖座標寫入目前限單機模式。
    </div>
  </section>
}
