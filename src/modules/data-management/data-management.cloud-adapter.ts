import { indexedBackupRepository, supabaseBackupRepository } from '../../database'
import type { BackupCounts, TravelBackup } from '../../database'
import type { CloudBackupPreview } from '../../database/supabase.repositories'

export interface CloudPreviewPayload {
  backup: TravelBackup
  preview: CloudBackupPreview
}

export interface DataManagementCloudAdapter {
  previewReplace(backup: TravelBackup): Promise<CloudBackupPreview>
  applyReplace(backup: TravelBackup, previewToken: string): Promise<BackupCounts>
  previewClearAllData(): Promise<CloudBackupPreview>
  applyClearAllData(previewToken: string): Promise<BackupCounts>
  previewLocalToCloudTransfer(): Promise<CloudPreviewPayload>
  transferLocalToCloud(backup: TravelBackup, previewToken: string): Promise<BackupCounts>
  transferCloudToLocal(): Promise<BackupCounts>
}

export const dataManagementCloudAdapter: DataManagementCloudAdapter = {
  previewReplace(backup) {
    return supabaseBackupRepository.previewReplaceAll(backup)
  },
  applyReplace(backup, previewToken) {
    return supabaseBackupRepository.replaceAll(backup, previewToken)
  },
  previewClearAllData() {
    return supabaseBackupRepository.previewClearAllData()
  },
  applyClearAllData(previewToken) {
    return supabaseBackupRepository.clearAllData(previewToken)
  },
  async previewLocalToCloudTransfer() {
    const backup = await indexedBackupRepository.exportAll()
    const preview = await supabaseBackupRepository.previewReplaceAll(backup)
    return { backup, preview }
  },
  transferLocalToCloud(backup, previewToken) {
    return supabaseBackupRepository.replaceAll(backup, previewToken)
  },
  async transferCloudToLocal() {
    const backup = await supabaseBackupRepository.exportAll()
    return indexedBackupRepository.replaceAll(backup)
  },
}