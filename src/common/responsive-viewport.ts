interface ViewportDimensions {
  screenWidth: number
  layoutWidth: number
  touch: boolean
}

export function needsScreenViewport({ screenWidth, layoutWidth, touch }: ViewportDimensions): boolean {
  return touch && screenWidth > 0 && screenWidth <= 760 && layoutWidth > screenWidth * 1.25
}

export function installResponsiveViewport(): () => void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  if (!meta) throw new Error('缺少 viewport 設定，無法初始化響應式版面。')
  const originalContent = meta.content
  const touchQuery = window.matchMedia('(any-pointer: coarse)')
  let corrected = false
  let lastScreenWidth = 0

  function update() {
    if (!meta) return
    const screenWidth = window.screen.width
    const touch = touchQuery.matches
    const root = document.documentElement
    if (corrected && (!touch || screenWidth > 760 || screenWidth <= 0)) {
      corrected = false
      lastScreenWidth = 0
      meta.content = originalContent
      delete root.dataset.screenViewportWidth
      return
    }
    if (!corrected && !needsScreenViewport({
      screenWidth,
      layoutWidth: root.clientWidth,
      touch,
    })) return
    if (corrected && lastScreenWidth === screenWidth) return

    // An explicit CSS-pixel width avoids relying on an incorrect device-width mapping.
    corrected = true
    lastScreenWidth = screenWidth
    root.dataset.screenViewportWidth = String(screenWidth)
    meta.content = `width=${screenWidth}, initial-scale=1.0`
  }

  window.addEventListener('resize', update)
  window.addEventListener('orientationchange', update)
  window.addEventListener('pageshow', update)
  window.visualViewport?.addEventListener('resize', update)
  touchQuery.addEventListener('change', update)
  update()

  return () => {
    window.removeEventListener('resize', update)
    window.removeEventListener('orientationchange', update)
    window.removeEventListener('pageshow', update)
    window.visualViewport?.removeEventListener('resize', update)
    touchQuery.removeEventListener('change', update)
    if (corrected) meta.content = originalContent
    delete document.documentElement.dataset.screenViewportWidth
  }
}
