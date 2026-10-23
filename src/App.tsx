import { useEffect } from 'react'
import './App.css'
import { PublicItineraryModule } from './modules/public-itinerary/PublicItineraryModule'
import { LabelModule } from './modules/label'
import { PlaceModule } from './modules/place'
import { RegionModule } from './modules/region'
import { ItineraryModule } from './modules/itinerary'
import { DataManagementModule } from './modules/data-management'
import { RouteCalculatorModule } from './modules/route-calculator'
import { routes } from './routes'
import { usePathname } from './usePathname'
import { useDatabaseMode } from './database/useDatabaseMode'
import { useMapProvider } from './geo/provider-preference'

function RoutedApp() {
  const pathname = usePathname().replace(/\/+$/, '') || '/'
  const { provider } = useMapProvider()
  const regionsDisabled = pathname === routes.regions && provider === 'osm'

  useEffect(() => {
    if (!regionsDisabled) return
    window.history.replaceState(null, '', routes.itinerary)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, [regionsDisabled])

  if (regionsDisabled) return <ItineraryModule />

  if (pathname === routes.publicItinerary) return <PublicItineraryModule />

  if (pathname === routes.routeCalculator) {
    return <RouteCalculatorModule />
  }

  if (pathname === routes.labels) {
    return <LabelModule />
  }

  if (pathname === routes.places) {
    return <PlaceModule />
  }

  if (pathname === routes.regions) {
    return <RegionModule key={provider} />
  }

  if (pathname === routes.itinerary) {
    return <ItineraryModule />
  }

  if (pathname === routes.dataManagement) {
    return <DataManagementModule />
  }

  return <ItineraryModule />
}

function App() {
  const mode = useDatabaseMode()
  return <RoutedApp key={mode} />
}

export default App
