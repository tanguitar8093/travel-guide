import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthGate } from './auth/AuthGate.tsx'
import { AuthProvider } from './auth/AuthProvider.tsx'
import { installResponsiveViewport } from './common/responsive-viewport'

const uninstallResponsiveViewport = installResponsiveViewport()
if (import.meta.hot) import.meta.hot.dispose(uninstallResponsiveViewport)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <AuthGate>
        <App />
      </AuthGate>
    </AuthProvider>
  </StrictMode>,
)
