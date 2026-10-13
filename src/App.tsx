import './App.css'
import { LabelModule } from './modules/label'
import { PlaceModule } from './modules/place'
import { routes } from './routes'
import { usePathname } from './usePathname'

function App() {
  const pathname = usePathname().replace(/\/+$/, '') || '/'

  if (pathname === routes.places) {
    return <PlaceModule />
  }

  return <LabelModule />
}

export default App
