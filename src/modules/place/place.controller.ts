import type { NewPlace, PlaceChanges } from '../../database'
import type { PlaceQuery } from './place.service'
import { PlaceService } from './place.service'

export class PlaceController {
  private readonly service: PlaceService

  constructor(service = new PlaceService()) {
    this.service = service
  }

  loadWorkspace() {
    return this.service.loadWorkspace()
  }

  getById(id: string) {
    return this.service.getById(id)
  }

  create(input: NewPlace) {
    return this.service.create(input)
  }

  update(id: string, changes: PlaceChanges) {
    return this.service.update(id, changes)
  }

  delete(id: string) {
    return this.service.delete(id)
  }

  search(query?: PlaceQuery) {
    return this.service.search(query)
  }
}

export const placeController = new PlaceController()
