import './App.css'
import { PlaceModule } from './modules/place'
import { RegionModule } from './modules/region'
import { ItineraryModule } from './modules/itinerary'
import { DataManagementModule } from './modules/data-management'
import { routes } from './routes'
import { usePathname } from './usePathname'

function App() {
  const pathname = usePathname().replace(/\/+$/, '') || '/'

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

export default App
