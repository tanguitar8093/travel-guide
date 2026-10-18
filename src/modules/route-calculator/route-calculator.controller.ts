import { RouteCalculatorService } from './route-calculator.service'
import type { RouteCalculationInput, RouteEndpoint } from './route-calculator.service'
import type { RouteMapChanges } from '../../database'

export class RouteCalculatorController {
  private readonly service: RouteCalculatorService

  constructor(service = new RouteCalculatorService()) {
    this.service = service
  }

  listPlaces() {
    return this.service.listPlaces()
  }

  listTrips() { return this.service.listTrips() }

  getRouteMap(id: string) { return this.service.getRouteMap(id) }

  getInitialRouteMap() { return this.service.getInitialRouteMap() }

  getOrCreateRouteMap(tripId?: string) { return this.service.getOrCreateRouteMap(tripId) }

  updateRouteMap(id: string, changes: RouteMapChanges) { return this.service.updateRouteMap(id, changes) }

  loadRouteMap(id: string) { return this.service.loadRouteMap(id) }

  addRouteMapPlace(routeMapId: string, googlePlaceId: string) {
    return this.service.addRouteMapPlace(routeMapId, googlePlaceId)
  }

  removeRouteMapPlace(routeMapId: string, googlePlaceId: string) {
    return this.service.removeRouteMapPlace(routeMapId, googlePlaceId)
  }

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
