import { RouteCalculatorService } from './route-calculator.service'
import type { RouteCalculationInput, RouteEndpoint } from './route-calculator.service'

export class RouteCalculatorController {
  constructor(private readonly service = new RouteCalculatorService()) {}

  listPlaces() {
    return this.service.listPlaces()
  }

  listTrips() { return this.service.listTrips() }

  loadTripMarkers(tripId: string) { return this.service.loadTripMarkers(tripId) }

  resolveEndpoint(endpoint: RouteEndpoint) { return this.service.resolveEndpoint(endpoint) }

  calculate(input: RouteCalculationInput) {
    return this.service.calculate(input)
  }

  isGooglePlacesConfigured() {
    return this.service.isGooglePlacesConfigured()
  }

  mountAutocomplete(...args: Parameters<RouteCalculatorService['mountAutocomplete']>) {
    return this.service.mountAutocomplete(...args)
  }
}

export const routeCalculatorController = new RouteCalculatorController()
