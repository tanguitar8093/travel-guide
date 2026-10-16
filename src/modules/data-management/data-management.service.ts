import {
  backupRepository,
  getDatabaseMode,
  setDatabaseMode,
} from '../../database'
import type { BackupCounts, DatabaseMode, TravelBackup } from '../../database'
import {
  dataManagementCloudAdapter,
  type CloudPreviewPayload,
  type DataManagementCloudAdapter,
} from './data-management.cloud-adapter'
import type { CloudBackupPreview } from '../../database/supabase.repositories'

export class DataManagementService {
  private readonly cloudAdapter: DataManagementCloudAdapter

  constructor(
    cloudAdapter: DataManagementCloudAdapter = dataManagementCloudAdapter,
  ) {
    this.cloudAdapter = cloudAdapter
  }

  exportBackup(): Promise<TravelBackup> {
    return backupRepository.exportAll()
  }

  parseBackup(contents: string): TravelBackup {
    let parsed: unknown
    try {
      parsed = JSON.parse(contents)
    } catch {
      throw new Error('檔案不是有效的 JSON，請選擇由本程式匯出的備份檔。')
    }
    return backupRepository.validateImport(parsed)
  }

  replaceAllData(backup: TravelBackup): Promise<BackupCounts> {
    return backupRepository.replaceAll(backup)
  }

  clearAllData(): Promise<BackupCounts | void> {
    return backupRepository.clearAllData()
  }

  async previewSupabaseReplace(backup: TravelBackup): Promise<CloudBackupPreview> {
    return this.cloudAdapter.previewReplace(backup)
  }

  async applySupabaseReplace(backup: TravelBackup, previewToken: string): Promise<BackupCounts> {
    return this.cloudAdapter.applyReplace(backup, previewToken)
  }

  async previewSupabaseClearAllData(): Promise<CloudBackupPreview> {
    return this.cloudAdapter.previewClearAllData()
  }

  async applySupabaseClearAllData(previewToken: string): Promise<BackupCounts> {
    return this.cloudAdapter.applyClearAllData(previewToken)
  }

  async previewLocalToSupabaseTransfer(): Promise<CloudPreviewPayload> {
    return this.cloudAdapter.previewLocalToCloudTransfer()
  }

  async transferLocalToSupabase(backup: TravelBackup, previewToken: string): Promise<BackupCounts> {
    return this.cloudAdapter.transferLocalToCloud(backup, previewToken)
  }

  async transferSupabaseToLocal(): Promise<BackupCounts> {
    return this.cloudAdapter.transferCloudToLocal()
  }

  getDatabaseMode(): DatabaseMode {
    return getDatabaseMode()
  }

  setDatabaseMode(mode: DatabaseMode): DatabaseMode {
    return setDatabaseMode(mode)
  }
}
