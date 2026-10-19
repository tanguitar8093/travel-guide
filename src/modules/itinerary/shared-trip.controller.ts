import { SharedTripService } from './shared-trip.service'

export class SharedTripController {
  private readonly service: SharedTripService
  constructor(service = new SharedTripService()) { this.service = service }
  list() { return this.service.list() }
  refresh() { return this.service.refresh() }
  enable(...args: Parameters<SharedTripService['enable']>) { return this.service.enable(...args) }
  cancel(...args: Parameters<SharedTripService['cancel']>) { return this.service.cancel(...args) }
  listOwnPlaces() { return this.service.listOwnPlaces() }
  tasks() { return this.service.tasks() }
  subscribe(...args: Parameters<SharedTripService['subscribe']>) { return this.service.subscribe(...args) }
  resolve(...args: Parameters<SharedTripService['resolve']>) { return this.service.resolve(...args) }
  loadMap(...args: Parameters<SharedTripService['loadMap']>) { return this.service.loadMap(...args) }
  saveItem(...args: Parameters<SharedTripService['saveItem']>) { return this.service.saveItem(...args) }
  deleteItem(...args: Parameters<SharedTripService['deleteItem']>) { return this.service.deleteItem(...args) }
  reorder(...args: Parameters<SharedTripService['reorder']>) { return this.service.reorder(...args) }
  calculateTravel(...args: Parameters<SharedTripService['calculateTravel']>) { return this.service.calculateTravel(...args) }
}

export const sharedTripController = new SharedTripController()
