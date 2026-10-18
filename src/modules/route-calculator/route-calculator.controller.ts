import { RouteCalculatorService } from './route-calculator.service'
import type { RouteCalculationInput } from './route-calculator.service'

export class RouteCalculatorController {
  constructor(private readonly service = new RouteCalculatorService()) {}

  listPlaces() {
    return this.service.listPlaces()
  }

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
