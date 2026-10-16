import type { TravelBackup } from '../../database'
import type { DatabaseMode } from '../../database'
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

  transferLocalToSupabase() {
    return this.service.transferLocalToSupabase()
  }

  transferSupabaseToLocal() {
    return this.service.transferSupabaseToLocal()
  }

  getDatabaseMode(): DatabaseMode {
    return this.service.getDatabaseMode()
  }

  setDatabaseMode(mode: DatabaseMode): DatabaseMode {
    return this.service.setDatabaseMode(mode)
  }
}

export const dataManagementController = new DataManagementController()
