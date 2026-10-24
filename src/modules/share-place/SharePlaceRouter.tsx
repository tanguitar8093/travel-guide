import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react'
import { usePathname } from '../../usePathname'
import { AuthGate, AuthLoadingPanel } from '../../auth/AuthGate'
import { sharePath } from './share-store'
const SharePlaceEntry = lazy(() => import('./SharePlaceEntry').then(module => ({ default: module.SharePlaceEntry })))
let appPromise: Promise<typeof import('../../App')> | undefined
export function SharePlaceRouter() {
  const pathname = usePathname()
  const sharing = pathname.replace(/\/+$/, '') === sharePath
  const [App, setApp] = useState<ComponentType>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (sharing) return
    let active = true
    // Start downloading while auth/welcome is still loading. Keep one loading panel throughout.
    appPromise ??= import('../../App')
    void appPromise.then(module => { if (active) setApp(() => module.default) }).catch(() => {
      appPromise = undefined
      if (active) setError('無法載入畫面，請確認網路後重試。')
    })
    return () => { active = false }
  }, [sharing, retry])
  if (sharing) return <Suspense fallback={<AuthLoadingPanel message="正在接收分享" />}><SharePlaceEntry key={location.search} /></Suspense>
  return <AuthGate pending={!App && !error}>
    {error ? <div className="auth-shell"><section className="auth-panel" role="alert"><p>{error}</p><button className="auth-secondary" type="button" onClick={() => { setError(''); setRetry(value => value + 1) }}>重試</button></section></div> : App ? <App /> : null}
  </AuthGate>
}
