const key = 'travel-planner:login-welcome'

export function requestLoginWelcome(): void {
  try { window.sessionStorage.setItem(key, 'pending') } catch { /* OAuth callback also identifies a fresh login. */ }
}

export function hasPendingLoginWelcome(): boolean {
  if (typeof window === 'undefined') return false
  const hash = new URLSearchParams(window.location.hash.slice(1))
  const query = new URLSearchParams(window.location.search)
  if (hash.has('access_token') || query.has('code')) return true
  try { return window.sessionStorage.getItem(key) === 'pending' } catch { return false }
}

export function clearLoginWelcome(): void {
  try { window.sessionStorage.removeItem(key) } catch { /* Presentation state only. */ }
}
