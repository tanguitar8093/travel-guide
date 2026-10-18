interface LayoutDebugBreakpoints {
  mobile: number
  compact: number
  narrow?: number
}

export function startLayoutDebug(
  { mobile, compact, narrow }: LayoutDebugBreakpoints,
  section: string,
): () => void {
  const startedAt = Date.now()
  const samples: string[] = []
  let eventCount = 0
  let omittedEvents = 0
  const matchesWidth = (width: number) =>
    window.matchMedia(`(max-width: ${width}px)`).matches
  const round = (value: number) => Math.round(value * 100) / 100
  const viewportMeta = () => Array.from(
    document.querySelectorAll('meta[name="viewport"]'),
    (meta) => meta.getAttribute('content') ?? '(無 content)',
  ).join(' | ') || '(缺少 viewport 標籤)'
  const initialMeta = viewportMeta()
  const contentLayout = () =>
    narrow !== undefined && matchesWidth(narrow)
      ? `手機窄版（≤ ${narrow}px）`
      : matchesWidth(mobile)
        ? `手機版（≤ ${mobile}px）`
        : matchesWidth(compact)
          ? `中寬版（> ${mobile}px、≤ ${compact}px）`
          : `電腦版（> ${compact}px）`
  const sidebarLayout = () => matchesWidth(760) ? '手機版' : '電腦版'
  const orientation = () => window.matchMedia('(orientation: portrait)').matches ? '直立' : '橫向'
  const desktopPointer = () => window.matchMedia(
    '(min-width: 761px) and (hover: hover) and (pointer: fine)',
  ).matches
  const widths = [...new Set([760, compact, mobile, ...(narrow === undefined ? [] : [narrow])])]

  function capture(reason: string) {
    const viewport = window.visualViewport
    const root = document.documentElement
    const requestedWidth = root.dataset.screenViewportWidth
    samples.push([
      `[${round((Date.now() - startedAt) / 1000)} 秒／${reason}]`,
      `螢幕 ${window.screen.width}×${window.screen.height}；inner ${window.innerWidth}×${window.innerHeight}；client ${root.clientWidth}×${root.clientHeight}；scroll ${root.scrollWidth}×${root.scrollHeight}`,
      `可視 ${viewport ? `${round(viewport.width)}×${round(viewport.height)}，縮放 ${round(viewport.scale)}` : '瀏覽器不支援'}；${orientation()}；頁面${document.visibilityState === 'visible' ? '前景' : '非前景'}`,
      `側欄 ${sidebarLayout()}；內容 ${contentLayout()}`,
      `螢幕寬度修正：${requestedWidth ? `已請求 ${requestedWidth}px；${Math.abs(root.clientWidth - Number(requestedWidth)) <= 2 ? '實際版面寬度已符合' : '實際版面仍不符，瀏覽器可能尚未套用或拒絕 viewport 設定'}` : '未觸發'}`,
    ].join('\n'))
  }

  function recordEvent(event: Event) {
    if (eventCount >= 8) {
      omittedEvents += 1
      return
    }
    eventCount += 1
    const source = event.currentTarget === window.visualViewport ? 'visualViewport' :
      event.currentTarget === window ? 'window' :
        event.currentTarget === document ? 'document' : 'mediaQuery'
    capture(`${source}.${event.type}`)
  }

  const mediaQueries = [
    ...widths.map((width) => window.matchMedia(`(max-width: ${width}px)`)),
    window.matchMedia('(orientation: portrait)'),
    window.matchMedia('(min-width: 761px) and (hover: hover) and (pointer: fine)'),
  ]
  const viewport = window.visualViewport
  window.addEventListener('resize', recordEvent)
  window.addEventListener('orientationchange', recordEvent)
  window.addEventListener('pageshow', recordEvent)
  document.addEventListener('visibilitychange', recordEvent)
  viewport?.addEventListener('resize', recordEvent)
  for (const query of mediaQueries) query.addEventListener('change', recordEvent)

  function stopListening() {
    window.removeEventListener('resize', recordEvent)
    window.removeEventListener('orientationchange', recordEvent)
    window.removeEventListener('pageshow', recordEvent)
    document.removeEventListener('visibilitychange', recordEvent)
    viewport?.removeEventListener('resize', recordEvent)
    for (const query of mediaQueries) query.removeEventListener('change', recordEvent)
  }

  capture('開始觀察')
  const secondSample = window.setTimeout(() => capture('2 秒取樣'), 2000)
  const finalSample = window.setTimeout(() => {
    capture('5 秒取樣')
    stopListening()
    window.alert([
      '管理員版型 DEBUG v3（螢幕寬度修正／0／2／5 秒觀察）',
      `頁面：${section} ${window.location.origin}${window.location.pathname}`,
      '所有尺寸單位：CSS px；時間為實際經過秒數。',
      '開始觀察是管理員設定載入後的頁面掛載時間，不是 HTML 開始下載時間。',
      '',
      ...samples,
      ...(omittedEvents ? [`另有 ${omittedEvents} 筆變動事件未逐筆列出；2／5 秒取樣仍保留。`] : []),
      '',
      `初始 viewport meta：${initialMeta}`,
      `最後 viewport meta：${viewportMeta()}`,
      `像素倍率 DPR：${window.devicePixelRatio}`,
      `側欄互動：${desktopPointer() ? '桌面滑鼠，可懸停展開' : '點擊開關，無懸停展開'}`,
      `最後媒體查詢：${widths.map((width) => `≤ ${width}px: ${matchesWidth(width) ? '符合' : '不符合'}`).join('；')}`,
      `瀏覽器：${window.navigator.userAgent}`,
      '版型名稱依媒體查詢判定，不代表已驗證所有元素排版正常。',
      'DEBUG 本身只觀察；響應式初始化會修正觸控小螢幕的異常 viewport，不變更地圖縮放設定。',
    ].join('\n'))
  }, 5000)

  return () => {
    window.clearTimeout(secondSample)
    window.clearTimeout(finalSample)
    stopListening()
  }
}
