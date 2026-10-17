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
import { requireHybridStore } from '../../database/hybrid.runtime'
import { previewHybridSync } from '../../database/sync-preview'
import { syncHybridManually } from '../../database/sync-engine'

export class DataManagementService {
  syncHybridManually() {
    if (getDatabaseMode() !== 'hybrid') throw new Error('請先切換到混合測試模式。')
    return syncHybridManually(requireHybridStore())
  }

  previewHybridSync() {
    if (getDatabaseMode() !== 'hybrid') throw new Error('請先切換到混合測試模式。')
    return previewHybridSync(requireHybridStore())
  }

  private readonly cloudAdapter: DataManagementCloudAdapter

  private assertCloudOperationAllowed(): void {
    if (getDatabaseMode() === 'hybrid') throw new Error('混合測試模式尚未開放雲端搬移或覆蓋操作。')
  }

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
    this.assertCloudOperationAllowed()
    return this.cloudAdapter.previewReplace(backup)
  }

  async applySupabaseReplace(backup: TravelBackup, previewToken: string): Promise<BackupCounts> {
    this.assertCloudOperationAllowed()
    return this.cloudAdapter.applyReplace(backup, previewToken)
  }

  async previewSupabaseClearAllData(): Promise<CloudBackupPreview> {
    this.assertCloudOperationAllowed()
    return this.cloudAdapter.previewClearAllData()
  }

  async applySupabaseClearAllData(previewToken: string): Promise<BackupCounts> {
    this.assertCloudOperationAllowed()
    return this.cloudAdapter.applyClearAllData(previewToken)
  }

  async previewLocalToSupabaseTransfer(): Promise<CloudPreviewPayload> {
    this.assertCloudOperationAllowed()
    return this.cloudAdapter.previewLocalToCloudTransfer()
  }

  async transferLocalToSupabase(backup: TravelBackup, previewToken: string): Promise<BackupCounts> {
    this.assertCloudOperationAllowed()
    return this.cloudAdapter.transferLocalToCloud(backup, previewToken)
  }

  async transferSupabaseToLocal(): Promise<BackupCounts> {
    this.assertCloudOperationAllowed()
    return this.cloudAdapter.transferCloudToLocal()
  }

  getDatabaseMode(): DatabaseMode {
    return getDatabaseMode()
  }

  setDatabaseMode(mode: DatabaseMode): DatabaseMode {
    return setDatabaseMode(mode)
  }
}
