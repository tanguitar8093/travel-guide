import { getDatabaseModeLabel } from '../database/runtime'
import { useDatabaseMode } from '../database/useDatabaseMode'
import { useAdminSyncInfo } from './useAdminSyncInfo'
import './WorkspaceInfoBar.css'

export function WorkspaceInfoBar({ section }: { section: string }) {
  const { visible } = useAdminSyncInfo()
  const mode = useDatabaseMode()
  if (!visible) return null

  return (
    <header className="workspace-info-bar" aria-label="工作區資訊">
      <div className="workspace-info-breadcrumb">
        <span>工作區</span>
        <span aria-hidden="true">/</span>
        <strong>{section}</strong>
      </div>
      <span className="workspace-info-mode">{getDatabaseModeLabel(mode)}</span>
    </header>
  )
}
