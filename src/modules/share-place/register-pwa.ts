export function registerShareWorker(): void {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return
  void navigator.serviceWorker.register('/share-worker.js', { scope: '/', updateViaCache: 'none' })
    .catch(cause => console.warn('[TripMap] 無法啟用 PWA 分享接收', cause))
}
