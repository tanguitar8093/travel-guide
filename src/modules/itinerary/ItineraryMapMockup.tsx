import { RouterLink } from '../../router'
import { routes } from '../../routes'
import './ItineraryMapMockup.css'

const stops = [
  { number: 1, name: '首里城', mapLabel: '首里城', time: '09:00', x: 23, y: 35, tone: 'green' },
  { number: 2, name: '瀨長島 Umikaji Terrace', mapLabel: '瀨長島', time: '12:00', x: 42, y: 59, tone: 'orange' },
  { number: 3, name: '國際通', mapLabel: '國際通', time: '15:30', x: 65, y: 42, tone: 'blue' },
  { number: 4, name: '波上宮', mapLabel: '波上宮', time: '18:00', x: 77, y: 26, tone: 'purple' },
]

function ItineraryMapMockup() {
  return (
    <main className="itinerary-mock">
      <header className="itinerary-mock-topbar">
        <RouterLink className="itinerary-mock-brand" to={routes.itinerary}>
          <span>漫</span>
          <strong>漫遊手帳</strong>
          <small>TRAVEL PLANNER</small>
        </RouterLink>
        <div className="itinerary-mock-topbar-right">
          <span className="itinerary-mock-badge">靜態 UI 示意</span>
          <RouterLink to={routes.itinerary}>返回目前行程頁</RouterLink>
        </div>
      </header>

      <section className="itinerary-mock-title">
        <div>
          <span>旅行地圖　/　沖繩</span>
          <h1>沖繩五日慢遊</h1>
          <p>2026 年 6 月 12 日 — 6 月 16 日 <i /> 5 天 4 夜</p>
        </div>
        <button type="button">＋ 新增行程</button>
      </section>

      <section className="itinerary-mock-workspace" aria-label="行程卡片與區域地圖示意">
        <aside className="itinerary-mock-plan">
          <div className="itinerary-mock-day-header">
            <div>
              <span>每日行程</span>
              <strong>DAY 1 <small>・那霸市區</small></strong>
            </div>
            <button type="button" aria-label="切換日期">⌄</button>
          </div>

          <div className="itinerary-mock-date-strip" aria-label="行程日期示意">
            <span className="selected"><small>五</small><strong>12</strong></span>
            <span><small>六</small><strong>13</strong></span>
            <span><small>日</small><strong>14</strong></span>
            <span><small>一</small><strong>15</strong></span>
            <span><small>二</small><strong>16</strong></span>
          </div>

          <div className="itinerary-mock-stop-list">
            {stops.map((stop) => (
              <article className={`itinerary-mock-stop ${stop.tone}`} key={stop.number}>
                <div className="itinerary-mock-stop-time">{stop.time}</div>
                <div className="itinerary-mock-stop-marker">{stop.number}</div>
                <div className="itinerary-mock-stop-copy">
                  <strong>{stop.name}</strong>
                  <span>{stop.number === 1 ? '停留約 2 小時' : stop.number === 2 ? '午餐・停留約 2 小時' : stop.number === 3 ? '逛街・自由活動' : '停留約 1 小時'}</span>
                </div>
                <button type="button" aria-label={`${stop.name}更多選項`}>···</button>
              </article>
            ))}
          </div>

          <button type="button" className="itinerary-mock-add-stop">＋ 加入地點</button>
          <div className="itinerary-mock-plan-foot">拖曳行程卡片即可調整造訪順序</div>
        </aside>

        <section className="itinerary-mock-map" aria-label="沖繩區域地圖靜態示意">
          <div className="itinerary-mock-map-art" aria-hidden="true">
            <svg viewBox="0 0 1000 740" preserveAspectRatio="xMidYMid slice">
              <defs>
                <pattern id="mock-grid" width="74" height="74" patternUnits="userSpaceOnUse">
                  <path d="M 74 0 L 0 0 0 74" fill="none" stroke="#dfe6dc" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width="1000" height="740" fill="#eaf2f0" />
              <path d="M0 0h1000v740H0z" fill="url(#mock-grid)" opacity=".5" />
              <path d="M0 85 110 20l88 35 46 76 104 6 83 72-15 92 44 54-42 69-110 27-52 96-93 42-87-21-76 69H0z" fill="#dce8d3" />
              <path d="m1000 0-98 69-25 74 45 55-35 74 38 78-63 59 7 83-57 48-4 91 68 68h124z" fill="#dce8d3" />
              <path d="M-50 548c160-85 257-55 363-132s166-88 252-53 175 19 241-50 119-123 244-113" fill="none" stroke="#fff" strokeWidth="22" />
              <path d="M-30 548c160-85 257-55 363-132s166-88 252-53 175 19 241-50 119-123 244-113" fill="none" stroke="#e8b878" strokeWidth="4" strokeDasharray="12 9" />
              <path d="M141 0c44 127 73 192 51 294s-19 161 71 243 150 118 186 203" fill="none" stroke="#fff" strokeWidth="15" />
              <path d="M141 0c44 127 73 192 51 294s-19 161 71 243 150 118 186 203" fill="none" stroke="#f6fbf8" strokeWidth="5" />
              <path d="M481 20c-23 137-6 208 85 287s132 155 112 263-54 124-23 170" fill="none" stroke="#fff" strokeWidth="13" />
              <path d="M481 20c-23 137-6 208 85 287s132 155 112 263-54 124-23 170" fill="none" stroke="#f6fbf8" strokeWidth="4" />
              <path d="M40 260c109 4 149 47 201 113s82 75 153 56m207-277c-19 98-4 137 66 175s119 26 180-3M316 606c73-49 117-49 185-4m92-327c84-23 119-10 177 50" fill="none" stroke="#fff" strokeWidth="8" />
              <g fill="#c7d8bf">
                <circle cx="163" cy="180" r="20" /><circle cx="311" cy="130" r="14" /><circle cx="824" cy="151" r="22" />
                <circle cx="856" cy="446" r="19" /><circle cx="357" cy="478" r="15" /><circle cx="711" cy="602" r="23" />
                <circle cx="94" cy="620" r="16" /><circle cx="575" cy="136" r="13" />
              </g>
              <g fill="#a8b6a6" fontFamily="sans-serif" fontSize="16" letterSpacing="2">
                <text x="78" y="116">首里</text><text x="305" y="260">那覇市</text><text x="708" y="203">浦添市</text>
                <text x="785" y="513">豊見城市</text><text x="180" y="675">南風原町</text>
              </g>
              <g fill="#c9dcd9" fontFamily="sans-serif" fontSize="14" letterSpacing="4">
                <text x="815" y="348">東　シ　ナ　海</text><text x="60" y="390">那　覇　港</text>
              </g>
            </svg>
          </div>

          <div className="itinerary-mock-map-label"><span>◎</span><div><strong>沖繩本島南部</strong><small>旅行範圍示意</small></div></div>
          <div className="itinerary-mock-map-tools">
            <button type="button" aria-label="放大">＋</button>
            <button type="button" aria-label="縮小">−</button>
            <button type="button" aria-label="定位範圍">⛶</button>
          </div>
          <div className="itinerary-mock-map-stops">
            {stops.map((stop) => (
              <div
                key={stop.number}
                className={`itinerary-mock-pin ${stop.tone}`}
                style={{ left: `${stop.x}%`, top: `${stop.y}%` }}
              >
                <span>{stop.number}</span>
                <strong>{stop.mapLabel}</strong>
              </div>
            ))}
            <svg className="itinerary-mock-route" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <path d="M23 35 Q32 46 42 59 T65 42 T77 26" />
            </svg>
          </div>
          <div className="itinerary-mock-map-credit">地圖版面靜態示意，非實際 Google Maps</div>
          <div className="itinerary-mock-map-legend"><i /> 行程順序 <span>1 → 4</span></div>
        </section>
      </section>
      <footer className="itinerary-mock-footer">此頁僅供確認版面方向，尚未串接資料、互動功能或地圖 API。</footer>
    </main>
  )
}

export default ItineraryMapMockup
