import { finishGooglePopup, isGooglePopupCallback } from './auth/google-popup'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { SharePlaceRouter } from './modules/share-place/SharePlaceRouter'
import { restoreShareAfterLogin } from './modules/share-place/share-store'
import { registerShareWorker } from './modules/share-place/register-pwa'
import { AuthProvider } from './auth/AuthProvider.tsx'

if (isGooglePopupCallback()) {
  void finishGooglePopup()
} else {
  restoreShareAfterLogin()
  registerShareWorker()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AuthProvider>
        <SharePlaceRouter />
      </AuthProvider>
    </StrictMode>,
  )
}
