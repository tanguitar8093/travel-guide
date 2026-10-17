import './App.css'
import { LabelModule } from './modules/label'
import { PlaceModule } from './modules/place'
import { RegionModule } from './modules/region'
import { ItineraryModule } from './modules/itinerary'
import { DataManagementModule } from './modules/data-management'
import { routes } from './routes'
import { usePathname } from './usePathname'
import { useDatabaseMode } from './database/useDatabaseMode'

function RoutedApp() {
  const pathname = usePathname().replace(/\/+$/, '') || '/'

  if (pathname === routes.labels) {
    return <LabelModule />
  }

  if (pathname === routes.places) {
    return <PlaceModule />
  }

  if (pathname === routes.regions) {
    return <RegionModule />
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
