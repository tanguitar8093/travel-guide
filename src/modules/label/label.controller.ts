import type { LabelChanges, NewLabel } from '../../database'
import { LabelService } from './label.service'

export class LabelController {
  private readonly service: LabelService

  constructor(service = new LabelService()) {
    this.service = service
  }

  listTree() {
    return this.service.listTree()
  }

  getById(id: string) {
    return this.service.getById(id)
  }

  create(input: NewLabel) {
    return this.service.create(input)
  }

  update(id: string, changes: LabelChanges) {
    return this.service.update(id, changes)
  }

  delete(id: string) {
    return this.service.delete(id)
  }

  deleteMany(ids: string[]) {
    return this.service.deleteMany(ids)
  }

  assignToPlace(placeId: string, labelId: string) {
    return this.service.assignToPlace(placeId, labelId)
  }

  removeFromPlace(placeId: string, labelId: string) {
    return this.service.removeFromPlace(placeId, labelId)
  }

  listPlaces() {
    return this.service.listPlaces()
  }

  findPlaces(labelId: string, includeDescendants = true) {
    return this.service.findPlaces(labelId, includeDescendants)
  }
}

export const labelController = new LabelController()
