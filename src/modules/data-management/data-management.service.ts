import {
  backupRepository,
  getDatabaseMode,
  indexedBackupRepository,
  setDatabaseMode,
  supabaseBackupRepository,
} from '../../database'
import type { BackupCounts, DatabaseMode, TravelBackup } from '../../database'
import type { CloudBackupPreview } from '../../database/supabase.repositories'

export interface CloudPreviewPayload {
  backup: TravelBackup
  preview: CloudBackupPreview
}

export class DataManagementService {
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
    return supabaseBackupRepository.previewReplaceAll(backup)
  }

  async applySupabaseReplace(backup: TravelBackup, previewToken: string): Promise<BackupCounts> {
    return supabaseBackupRepository.replaceAll(backup, previewToken)
  }

  async previewSupabaseClearAllData(): Promise<CloudBackupPreview> {
    return supabaseBackupRepository.previewClearAllData()
  }

  async applySupabaseClearAllData(previewToken: string): Promise<BackupCounts> {
    return supabaseBackupRepository.clearAllData(previewToken)
  }

  async previewLocalToSupabaseTransfer(): Promise<CloudPreviewPayload> {
    const backup = await indexedBackupRepository.exportAll()
    const preview = await supabaseBackupRepository.previewReplaceAll(backup)
    return { backup, preview }
  }

  async transferLocalToSupabase(backup: TravelBackup, previewToken: string): Promise<BackupCounts> {
    return supabaseBackupRepository.replaceAll(backup, previewToken)
  }

  async transferSupabaseToLocal(): Promise<BackupCounts> {
    const backup = await supabaseBackupRepository.exportAll()
    return indexedBackupRepository.replaceAll(backup)
  }

  getDatabaseMode(): DatabaseMode {
    return getDatabaseMode()
  }

  setDatabaseMode(mode: DatabaseMode): DatabaseMode {
    return setDatabaseMode(mode)
  }
}
