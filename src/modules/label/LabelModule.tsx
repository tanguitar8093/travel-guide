import './LabelModule.css'

const labelGroups = [
  {
    name: '美食',
    color: '#e9905a',
    children: [
      { name: '咖啡廳', color: '#b77a53', count: 8 },
      { name: '在地小吃', color: '#d97768', count: 12 },
      { name: '甜點', color: '#c4809b', count: 5 },
    ],
    count: 25,
  },
  {
    name: '景點',
    color: '#6e9f89',
    children: [
      { name: '博物館', color: '#758dab', count: 4 },
      { name: '自然風景', color: '#6c9a79', count: 7 },
    ],
    count: 14,
  },
  {
    name: '住宿',
    color: '#8b80b5',
    children: [],
    count: 3,
  },
]

const appliedLabels = [
  { name: '美食', color: '#e9905a' },
  { name: '咖啡廳', color: '#b77a53' },
]

function LabelModule() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="漫遊手帳首頁">
          <span className="brand-mark">漫</span>
          <span>
            <strong>漫遊手帳</strong>
            <small>TRAVEL PLANNER</small>
          </span>
        </a>

        <div className="workspace-label">工作區</div>
        <nav className="main-nav" aria-label="主要導覽">
          <a href="#" className="nav-item">
            <span className="nav-icon">⌖</span>
            地點
          </a>
          <a href="#" className="nav-item">
            <span className="nav-icon">▤</span>
            行程
          </a>
          <a href="#" className="nav-item active" aria-current="page">
            <span className="nav-icon">◈</span>
            標籤管理
            <span className="nav-count">12</span>
          </a>
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
            <strong>標籤管理</strong>
          </div>
          <div className="topbar-actions">
            <span className="prototype-badge">介面示意</span>
            <button className="icon-button" type="button" aria-label="說明">?</button>
            <div className="user-avatar" aria-label="使用者">T</div>
          </div>
        </header>

        <div className="page-content">
          <section className="page-heading">
            <div>
              <div className="eyebrow">整理你的探索地圖</div>
              <h1>標籤管理</h1>
              <p>建立分類層級，讓收藏的地點更容易整理與尋找。</p>
            </div>
            <button className="primary-button" type="button" disabled>
              <span aria-hidden="true">＋</span>
              新增標籤
            </button>
          </section>

          <div className="module-tabs" role="tablist" aria-label="標籤模組頁面">
            <button className="module-tab selected" type="button" role="tab" aria-selected="true">
              標籤分類
            </button>
            <button className="module-tab" type="button" role="tab" aria-selected="false" disabled>
              地點套用預覽
              <span className="soon-label">規劃中</span>
            </button>
          </div>

          <section className="workspace-grid" aria-label="標籤管理介面示意">
            <div className="panel taxonomy-panel">
              <div className="panel-heading">
                <div>
                  <h2>標籤分類</h2>
                  <p>以階層整理標籤</p>
                </div>
                <button className="subtle-icon-button" type="button" aria-label="更多分類選項" disabled>
                  ···
                </button>
              </div>

              <label className="search-box">
                <span aria-hidden="true">⌕</span>
                <input type="search" placeholder="搜尋標籤" disabled />
                <kbd>⌘ K</kbd>
              </label>

              <div className="tree-list">
                <div className="tree-section-label">所有標籤 <span>12</span></div>
                {labelGroups.map((group) => (
                  <div className="tree-group" key={group.name}>
                    <div className="tree-row parent-row">
                      <span className="chevron">⌄</span>
                      <span className="color-dot" style={{ backgroundColor: group.color }} />
                      <span className="tree-name">{group.name}</span>
                      <span className="tree-count">{group.count}</span>
                      <button className="row-menu" type="button" aria-label={`${group.name}選項`} disabled>
                        ···
                      </button>
                    </div>
                    {group.children.map((child) => (
                      <div className="tree-row child-row" key={child.name}>
                        <span className="tree-branch" aria-hidden="true" />
                        <span className="color-dot" style={{ backgroundColor: child.color }} />
                        <span className="tree-name">{child.name}</span>
                        <span className="tree-count">{child.count}</span>
                        <button className="row-menu" type="button" aria-label={`${child.name}選項`} disabled>
                          ···
                        </button>
                      </div>
                    ))}
                    {group.name === '美食' && (
                      <button className="add-child-link" type="button" disabled>
                        <span>＋</span> 新增子標籤
                      </button>
                    )}
                  </div>
                ))}
                <button className="add-root-link" type="button" disabled>
                  <span>＋</span> 新增分類
                </button>
              </div>

              <div className="tree-footer">
                <span className="footer-dot" />
                可建立多層子標籤
              </div>
            </div>

            <div className="detail-column">
              <section className="panel detail-panel">
                <div className="panel-heading detail-heading">
                  <div>
                    <div className="section-kicker">標籤詳細資料</div>
                    <h2><span className="large-color-dot" />咖啡廳</h2>
                  </div>
                  <button className="subtle-icon-button" type="button" aria-label="更多標籤選項" disabled>
                    ···
                  </button>
                </div>

                <div className="form-fields">
                  <label className="form-field">
                    <span>標籤名稱</span>
                    <input value="咖啡廳" readOnly />
                  </label>

                  <div className="form-field">
                    <span>標籤顏色</span>
                    <div className="color-picker-placeholder">
                      <span className="selected-color" />
                      <span>陶土棕</span>
                      <span className="field-chevron">⌄</span>
                    </div>
                    <div className="color-swatches" aria-label="可選顏色示意">
                      {['#e9905a', '#d97768', '#c4809b', '#8b80b5', '#758dab', '#6c9a79', '#b77a53'].map((color) => (
                        <span
                          className={`color-swatch${color === '#b77a53' ? ' chosen' : ''}`}
                          key={color}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>

                  <label className="form-field">
                    <span>上層分類</span>
                    <div className="select-placeholder">
                      <span><span className="mini-color-dot" />美食</span>
                      <span className="field-chevron">⌄</span>
                    </div>
                    <small>調整上層分類即可移動此標籤。</small>
                  </label>
                </div>

                <div className="detail-actions">
                  <span>最後更新：尚未儲存</span>
                  <button className="save-button" type="button" disabled>儲存變更</button>
                </div>
              </section>

              <section className="panel usage-panel">
                <div className="usage-heading">
                  <div>
                    <h2>套用中的地點</h2>
                    <p>這個標籤目前套用於 <strong>8 個地點</strong></p>
                  </div>
                  <button className="text-button" type="button" disabled>查看全部 <span>→</span></button>
                </div>
                <div className="place-preview-list">
                  <div className="place-preview">
                    <div className="place-thumbnail coffee-thumbnail">珈</div>
                    <div className="place-copy">
                      <strong>巷口珈琲</strong>
                      <span>台北・大安區</span>
                    </div>
                    <span className="place-tag">{appliedLabels[0].name}</span>
                    <span className="place-tag">{appliedLabels[1].name}</span>
                  </div>
                  <div className="place-preview">
                    <div className="place-thumbnail book-thumbnail">日</div>
                    <div className="place-copy">
                      <strong>日向咖啡</strong>
                      <span>台北・中山區</span>
                    </div>
                    <span className="place-tag">{appliedLabels[0].name}</span>
                    <span className="place-tag">{appliedLabels[1].name}</span>
                  </div>
                </div>
                <div className="usage-note">
                  <span aria-hidden="true">ⓘ</span>
                  選取父層分類時，可一併找到底下子標籤的地點。
                </div>
              </section>
            </div>
          </section>
          <footer className="page-footer">標籤管理介面草稿 <span>•</span> 資料為畫面示意，尚未連接資料庫</footer>
        </div>
      </main>
    </div>
  )
}

export default LabelModule
