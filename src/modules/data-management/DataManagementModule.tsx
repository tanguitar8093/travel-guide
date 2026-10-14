import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { TravelBackup } from '../../database'
import { WorkspaceLayout } from '../../common/WorkspaceLayout'
import { dataManagementController } from './data-management.controller'
import './DataManagementModule.css'

const countLabels = [
  ['regions', '區域'],
  ['places', '地點'],
  ['labels', '標籤'],
  ['trips', '行程'],
  ['itineraryItems', '每日行程項目'],
] as const

function formatCount(counts: Record<(typeof countLabels)[number][0], number>): string {
  return countLabels.map(([key, label]) => `${label} ${counts[key]}`).join('、')
}

function DataManagementModule() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [backup, setBackup] = useState<TravelBackup>()
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function handleExport() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const exported = await dataManagementController.exportBackup()
      const blob = new Blob([`${JSON.stringify(exported, null, 2)}\n`], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `travel-planner-backup-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
      setNotice(`備份已匯出：${formatCount({
        regions: exported.data.regions.length,
        places: exported.data.places.length,
        labels: exported.data.labels.length,
        trips: exported.data.trips.length,
        itineraryItems: exported.data.itineraryItems.length,
      })}。`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '匯出資料失敗。')
    } finally {
      setBusy(false)
    }
  }

  async function handleFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    setBackup(undefined)
    setFileName('')
    setError('')
    setNotice('')
    if (!file) return
    setBusy(true)
    try {
      const parsedBackup = dataManagementController.parseBackup(await file.text())
      setBackup(parsedBackup)
      setFileName(file.name)
      setNotice(`備份檔驗證通過：${formatCount({
        regions: parsedBackup.data.regions.length,
        places: parsedBackup.data.places.length,
        labels: parsedBackup.data.labels.length,
        trips: parsedBackup.data.trips.length,
        itineraryItems: parsedBackup.data.itineraryItems.length,
      })}。`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '無法讀取或驗證備份檔。')
    } finally {
      setBusy(false)
      event.target.value = ''
    }
  }

  async function handleImport() {
    if (!backup) return
    const summary = formatCount({
      regions: backup.data.regions.length,
      places: backup.data.places.length,
      labels: backup.data.labels.length,
      trips: backup.data.trips.length,
      itineraryItems: backup.data.itineraryItems.length,
    })
    if (!window.confirm(
      `即將用「${fileName}」覆蓋此瀏覽器中的全部資料。\n\n匯入內容：${summary}\n\n目前的資料會被完全取代，且無法從本程式復原。建議先匯出目前資料作為備份。確定繼續嗎？`,
    )) return

    setBusy(true)
    setError('')
    setNotice('')
    try {
      const counts = await dataManagementController.replaceAllData(backup)
      setBackup(undefined)
      setFileName('')
      setNotice(`資料已完整匯入：${formatCount(counts)}。`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '匯入資料失敗；原有資料未變更。')
    } finally {
      setBusy(false)
    }
  }

  async function handleClearAllData() {
    if (!window.confirm('即將清空此瀏覽器中的全部資料庫內容。\n\n包括：區域、地點、標籤、行程與每日行程項目。\n\n此操作無法撤銷，請先確認是否已備份。確定要清空嗎？')) {
      return
    }

    setBusy(true)
    setError('')
    setNotice('')
    try {
      await dataManagementController.clearAllData()
      setBackup(undefined)
      setFileName('')
      setNotice('資料庫已清空，所有旅遊資料已移除。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '清空資料失敗。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <WorkspaceLayout
      active="data"
      shellClassName="data-management-shell"
      mainClassName="data-management-main"
    >
        <header className="data-management-topbar">
          <span>工作區　/　資料管理</span>
          <span>本機資料</span>
        </header>
        <section className="data-management-content">
          <div className="data-management-heading">
            <div>
              <div className="data-management-eyebrow">備份、搬移與還原你的旅行資料</div>
              <h1>資料管理</h1>
              <p>匯出所有模組資料，或從備份檔完整取代此瀏覽器中的資料。</p>
            </div>
          </div>

          {error && <div className="data-management-feedback data-management-error" role="alert">{error}</div>}
          {notice && <div className="data-management-feedback data-management-success" role="status">{notice}</div>}

          <div className="data-management-cards">
            <section className="data-management-card">
              <div className="data-management-card-icon">↓</div>
              <h2>匯出備份</h2>
              <p>下載包含區域、地點、標籤、行程與每日行程項目的完整 JSON 備份。</p>
              <button type="button" className="data-management-primary" disabled={busy} onClick={() => void handleExport()}>
                {busy ? '處理中…' : '匯出所有資料'}
              </button>
            </section>

            <section className="data-management-card data-management-import-card">
              <div className="data-management-card-icon">↑</div>
              <h2>匯入並覆蓋</h2>
              <p>只接受格式正確、版本相容且資料關聯完整的本程式備份。驗證通過後才會替換現有資料。</p>
              <input
                ref={fileInputRef}
                className="data-management-file-input"
                type="file"
                accept=".json,application/json"
                aria-label="選擇 Travel Planner 備份檔"
                disabled={busy}
                onChange={(event) => void handleFileSelected(event)}
              />
              <div className="data-management-actions">
                <button type="button" className="data-management-secondary" disabled={busy} onClick={() => fileInputRef.current?.click()}>
                  選擇備份檔
                </button>
                {backup && (
                  <button type="button" className="data-management-danger" disabled={busy} onClick={() => void handleImport()}>
                    {busy ? '匯入中…' : '確認覆蓋匯入'}
                  </button>
                )}
              </div>
              {backup && <p className="data-management-selected-file">已驗證：{fileName}</p>}
              <div className="data-management-warning" role="note">
                匯入會取代此瀏覽器的全部旅行資料，不會合併。請確認已選對備份檔，並先匯出目前資料以免遺失。
              </div>
            </section>

            <section className="data-management-card data-management-import-card">
              <div className="data-management-card-icon">⌫</div>
              <h2>清空資料庫</h2>
              <p>將此瀏覽器中所有旅行資料一次性刪除，包括區域、地點、標籤、行程與每日行程項目。</p>
              <div className="data-management-actions">
                <button type="button" className="data-management-danger" disabled={busy} onClick={() => void handleClearAllData()}>
                  {busy ? '清空中…' : '清空整個資料庫'}
                </button>
              </div>
              <div className="data-management-warning" role="note">
                這是破壞性操作，且不會保留可回復內容。建議先匯出備份後再執行。
              </div>
            </section>
          </div>
        </section>
    </WorkspaceLayout>
  )
}

export default DataManagementModule
