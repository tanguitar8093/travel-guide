import type { TravelBackup } from '../../database'
import { DataManagementService } from './data-management.service'

export class DataManagementController {
  private readonly service: DataManagementService

  constructor(service = new DataManagementService()) {
    this.service = service
  }

  exportBackup() {
    return this.service.exportBackup()
  }

  parseBackup(contents: string) {
    return this.service.parseBackup(contents)
  }

  replaceAllData(backup: TravelBackup) {
    return this.service.replaceAllData(backup)
  }

  clearAllData() {
    return this.service.clearAllData()
  }
}

export const dataManagementController = new DataManagementController()
