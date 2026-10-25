import { useOsmDataset } from './geo/osm-dataset-preference'
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
  const dataset = useOsmDataset()
  const pathname = usePathname().replace(/\/+$/, '') || '/'
  // The map picker updates in place; other workspaces reload for their dataset.
  const workspaceKey = pathname === routes.regions ? mode : `${mode}:${dataset ?? 'invalid'}`
  return <RoutedApp key={workspaceKey} />
}

export default App
