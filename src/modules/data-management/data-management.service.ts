import {
  backupRepository,
  getDatabaseMode,
  indexedBackupRepository,
  setDatabaseMode,
  supabaseBackupRepository,
} from '../../database'
import type { BackupCounts, DatabaseMode, TravelBackup } from '../../database'

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

  clearAllData(): Promise<void> {
    return backupRepository.clearAllData()
  }

  async transferLocalToSupabase(): Promise<BackupCounts> {
    const backup = await indexedBackupRepository.exportAll()
    return supabaseBackupRepository.replaceAll(backup)
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
