import { createRoot } from 'react-dom/client'
import { AuthContext } from '../../src/auth/auth-context'
import RouteCalculatorModule from '../../src/modules/route-calculator/RouteCalculatorModule'
import ItineraryModule from '../../src/modules/itinerary/ItineraryModule'
import PlaceModule from '../../src/modules/place/PlaceModule'
import { usePathname } from '../../src/usePathname'
import '../../src/index.css'
import '../../src/App.css'
import './preview.css'

function PreviewApp() {
  const path = usePathname()
  if (path === '/places') return <PlaceModule />
  if (path === '/route-calculator') return <RouteCalculatorModule />
  return <ItineraryModule />
}

createRoot(document.getElementById('root')!).render(
  <AuthContext.Provider value={{
    status: 'authenticated', session: null, user: null, userRole: 'basic',
    hasWorkspaceAccess: true, errorMessage: null,
    signInWithPassword: async () => {},
    signUpWithPassword: async () => ({ requiresEmailConfirmation: false }),
    signOut: async () => {}, clearError: () => {},
  }}>
    <PreviewApp />
  </AuthContext.Provider>,
)
