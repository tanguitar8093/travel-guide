import type { TravelBackup } from '../../database'
import type { DatabaseMode } from '../../database'
import { DataManagementService } from './data-management.service'
import type { CloudPreviewPayload } from './data-management.cloud-adapter'

export class DataManagementController {
  private readonly service: DataManagementService

  constructor(service = new DataManagementService()) {
    this.service = service
  }

  exportBackup() {
    return this.service.exportBackup()
  }

  previewHybridSync() {
    return this.service.previewHybridSync()
  }

  syncHybridManually() {
    return this.service.syncHybridManually()
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

  previewSupabaseReplace(backup: TravelBackup) {
    return this.service.previewSupabaseReplace(backup)
  }

  applySupabaseReplace(backup: TravelBackup, previewToken: string) {
    return this.service.applySupabaseReplace(backup, previewToken)
  }

  previewSupabaseClearAllData() {
    return this.service.previewSupabaseClearAllData()
  }

  applySupabaseClearAllData(previewToken: string) {
    return this.service.applySupabaseClearAllData(previewToken)
  }

  previewLocalToSupabaseTransfer(): Promise<CloudPreviewPayload> {
    return this.service.previewLocalToSupabaseTransfer()
  }

  transferLocalToSupabase(backup: TravelBackup, previewToken: string) {
    return this.service.transferLocalToSupabase(backup, previewToken)
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
