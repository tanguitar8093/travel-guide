import { useState } from 'react'

type MapProvider = 'google' | 'osm'

const providerDetails: Record<MapProvider, { name: string; shortName: string; description: string }> = {
  google: {
    name: 'Google Maps',
    shortName: 'Google',
    description: '以 Google Maps 作為地圖預覽樣式。',
  },
  osm: {
    name: 'OpenStreetMap',
    shortName: 'OSM',
    description: '以 OpenStreetMap 作為地圖預覽樣式。',
  },
}

function MapIllustration({ provider }: { provider: MapProvider }) {
  return (
    <div className={`map-illustration map-illustration-${provider}`} aria-label={`${providerDetails[provider].name} 地圖風格示意圖`}>
      <svg viewBox="0 0 760 390" role="img" aria-label="含道路、公園、水域與地點標記的地圖示意">
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
          <text x="54" y="77">中央公園</text>
          <text x="75" y="98">CENTRAL PARK</text>
          <text x="376" y="82">中城區</text>
          <text x="580" y="253">河畔綠地</text>
          <text x="112" y="251">文化街區</text>
          <text x="557" y="124">市民廣場</text>
          <text x="560" y="359">海岸步道</text>
        </g>
        <g className="map-place-marker" transform="translate(427 180)">
          <circle className="map-marker-shadow" r="22" />
          <path className="map-marker-pin" d="M0-17 C-10-17-17-9-17 1 C-17 14 0 27 0 27 S17 14 17 1 C17-9 10-17 0-17Z" />
          <circle className="map-marker-dot" r="5" />
        </g>
      </svg>
      <div className="map-zoom-controls" aria-hidden="true"><span>+</span><span>−</span></div>
      <div className="map-preview-label">{providerDetails[provider].shortName} 風格示意</div>
    </div>
  )
}

export default function MapProviderSettingsDemo() {
  const [provider, setProvider] = useState<MapProvider>('google')
  const selectedProvider = providerDetails[provider]

  return (
    <div className="demo-app">
      <aside className="demo-sidebar" aria-label="主要導覽">
        <a className="demo-brand" href="#data-settings" aria-label="旅圖 · TripMap">
          <span className="demo-brand-mark" aria-hidden="true">T</span>
          <span><strong>旅圖 · TripMap</strong><small>PLAN YOUR JOURNEY</small></span>
        </a>
        <div className="demo-nav-caption">工作區</div>
        <nav className="demo-nav">
          <a href="#itinerary"><span className="demo-nav-icon" aria-hidden="true">▦</span>行程</a>
          <a href="#places"><span className="demo-nav-icon" aria-hidden="true">⌖</span>地點</a>
          <a href="#route"><span className="demo-nav-icon" aria-hidden="true">↗</span>路程試算</a>
          <a className="demo-nav-current" href="#data-settings" aria-current="page"><span className="demo-nav-icon" aria-hidden="true">▤</span>資料</a>
        </nav>
        <div className="demo-sidebar-note">UI 預覽<br />不會變更正式資料</div>
      </aside>

      <main className="demo-main" id="data-settings">
        <header className="demo-topbar">
          <span>工作區 <span aria-hidden="true">/</span> 資料</span>
          <span className="demo-preview-status"><i aria-hidden="true" /> UI Demo</span>
        </header>

        <div className="demo-content">
          <div className="demo-page-heading">
            <div>
              <div className="demo-eyebrow">WORKSPACE SETTINGS</div>
              <h1>資料</h1>
              <p>管理旅行資料與偏好設定。</p>
            </div>
          </div>

          <div className="demo-tabs" role="tablist" aria-label="資料設定分類">
            <button type="button" role="tab" aria-selected="false">資料搬移</button>
            <button type="button" role="tab" aria-selected="true" className="demo-tab-current">偏好設定</button>
          </div>

          <section className="settings-card" aria-labelledby="map-settings-heading">
            <div className="settings-card-heading">
              <div className="settings-card-icon" aria-hidden="true">⌖</div>
              <div>
                <h2 id="map-settings-heading">地圖設定</h2>
                <p>選擇你偏好的地圖服務。</p>
              </div>
            </div>

            <div className="provider-setting">
              <label htmlFor="map-provider">地圖供應商</label>
              <select
                id="map-provider"
                value={provider}
                onChange={(event) => setProvider(event.target.value as MapProvider)}
              >
                <option value="google">Google Maps</option>
                <option value="osm">OpenStreetMap (OSM)</option>
              </select>
              <p className="provider-description">{selectedProvider.description}</p>
            </div>

            <div className="provider-preview" aria-live="polite">
              <div className="provider-preview-heading">
                <div>
                  <span className="preview-kicker">互動預覽</span>
                  <h3>地圖外觀</h3>
                </div>
                <span className={`provider-pill provider-pill-${provider}`}>
                  <i aria-hidden="true" />
                  {selectedProvider.name}
                </span>
              </div>
              <MapIllustration provider={provider} />
              <p className="illustration-disclaimer">地圖為介面風格示意，非即時圖資或可操作地圖。</p>
            </div>

            <div className="demo-notice" role="note">
              <span className="demo-notice-icon" aria-hidden="true">i</span>
              <p><strong>展示模式</strong>　切換選項會即時更新本頁示意畫面；不會儲存設定，也不會呼叫 Google 或 OSM 服務。</p>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
