import './App.css'
import { LabelModule } from './modules/label'
import { PlaceModule } from './modules/place'
import { RegionModule } from './modules/region'
import { ItineraryModule } from './modules/itinerary'
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

  return <LabelModule />
}

export default App
