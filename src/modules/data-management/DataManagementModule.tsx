import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { DatabaseMode, SyncMode, TravelBackup } from "../../database";
import { setSyncMode, useDatabaseMode, useSyncMode } from "../../database";
import { WorkspaceLayout } from "../../common/WorkspaceLayout";
import { dataManagementController } from "./data-management.controller";
import "./DataManagementModule.css";
import { useHybridStatus } from '../../database/useHybridStatus';
import { HybridSyncPreview } from './HybridSyncPreview';
import { useAdminSyncInfo } from '../../common/useAdminSyncInfo';
import { useAuth } from '../../auth/useAuth';

const countLabels = [
  ["regions", "區域"],
  ["places", "地點"],
  ["labels", "標籤"],
  ["trips", "行程"],
  ["itineraryItems", "每日行程項目"],
] as const;

function formatCount(
  counts: Record<(typeof countLabels)[number][0], number>,
): string {
  return countLabels
    .map(([key, label]) => `${label} ${counts[key]}`)
    .join("、");
}

function formatPreviewCounts(
  current: Record<(typeof countLabels)[number][0], number>,
  incoming: Record<(typeof countLabels)[number][0], number>,
): string {
  return countLabels
    .map(([key, label]) => `${label} 目前 ${current[key]} → 匯入 ${incoming[key]}`)
    .join("\n");
}

function DataManagementModule() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const databaseMode = useDatabaseMode();
  const syncMode = useSyncMode();
  const hybridStatus = useHybridStatus();
  const syncInfo = useAdminSyncInfo();
  const { status: authStatus, userRole, hasWorkspaceAccess } = useAuth();
  const canDebugModes = authStatus === 'authenticated' && userRole === 'admin' && hasWorkspaceAccess;
  const [backup, setBackup] = useState<TravelBackup>();
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function handleDatabaseModeChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextMode = event.target.value as DatabaseMode;
    if (nextMode === databaseMode) return;

    try {
      dataManagementController.setDatabaseMode(nextMode);
      setBackup(undefined);
      setFileName('');
      setError('');
      setNotice(nextMode === 'hybrid' ? '混合測試從獨立本地資料開始，不會自動搬移或上傳雲端資料。' : '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '切換失敗。');
    }
  }

  function handleSyncModeChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextMode = event.target.value as SyncMode;
    if (nextMode === syncMode) return;

    setSyncMode(nextMode);
    setNotice(nextMode === 'auto' ? '已切換至自動同步模式。' : '已切回手動同步模式。');
  }

  async function handleExport() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const exported = await dataManagementController.exportBackup();
      const blob = new Blob([`${JSON.stringify(exported, null, 2)}\n`], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `travel-planner-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setNotice(
        `備份已匯出：${formatCount({
          regions: exported.data.regions.length,
          places: exported.data.places.length,
          labels: exported.data.labels.length,
          trips: exported.data.trips.length,
          itineraryItems: exported.data.itineraryItems.length,
        })}。`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "匯出資料失敗。");
    } finally {
      setBusy(false);
    }
  }

  async function handleFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setBackup(undefined);
    setFileName("");
    setError("");
    setNotice("");
    if (!file) return;
    setBusy(true);
    try {
      const parsedBackup = dataManagementController.parseBackup(
        await file.text(),
      );
      setBackup(parsedBackup);
      setFileName(file.name);
      setNotice(
        `備份檔驗證通過：${formatCount({
          regions: parsedBackup.data.regions.length,
          places: parsedBackup.data.places.length,
          labels: parsedBackup.data.labels.length,
          trips: parsedBackup.data.trips.length,
          itineraryItems: parsedBackup.data.itineraryItems.length,
        })}。`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "無法讀取或驗證備份檔。",
      );
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  async function handleImport() {
    if (!backup) return;

    const summary = formatCount({
      regions: backup.data.regions.length,
      places: backup.data.places.length,
      labels: backup.data.labels.length,
      trips: backup.data.trips.length,
      itineraryItems: backup.data.itineraryItems.length,
    });

    if (databaseMode === "supabase") {
      setBusy(true);
      setError("");
      setNotice("");
      try {
        const preview = await dataManagementController.previewSupabaseReplace(backup);
        const previewDetail = formatPreviewCounts(preview.current, preview.incoming);
        if (
          !window.confirm(
            `即將覆蓋目前登入帳號的雲端資料。\n\n${previewDetail}\n\n確認後會以匯入資料完整取代目前帳號在雲端的資料。是否繼續？`,
          )
        ) {
          return;
        }

        const counts = await dataManagementController.applySupabaseReplace(
          backup,
          preview.token,
        );
        setBackup(undefined);
        setFileName("");
        setNotice(`雲端資料已覆蓋：${formatCount(counts)}。`);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "雲端覆蓋失敗，請重新預覽後再試。",
        );
      } finally {
        setBusy(false);
      }
      return;
    }

    if (
      !window.confirm(
        `即將用「${fileName}」覆蓋此瀏覽器中的全部資料。\n\n匯入內容：${summary}\n\n目前的資料會被完全取代，且無法從本程式復原。建議先匯出目前資料作為備份。確定繼續嗎？`,
      )
    )
      return;

    setBusy(true);
    setError("");
    setNotice("");
    try {
      const counts = await dataManagementController.replaceAllData(backup);
      setBackup(undefined);
      setFileName("");
      setNotice(`資料已完整匯入：${formatCount(counts)}。`);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "匯入資料失敗；原有資料未變更。",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleClearAllData() {
    if (databaseMode === "supabase") {
      setBusy(true);
      setError("");
      setNotice("");
      try {
        const preview = await dataManagementController.previewSupabaseClearAllData();
        if (
          !window.confirm(
            `即將清空目前登入帳號的雲端資料。\n\n${formatCount(
              preview.current,
            )}\n\n此操作無法撤銷，且不會影響其他帳號資料。確定繼續嗎？`,
          )
        ) {
          return;
        }

        const counts = await dataManagementController.applySupabaseClearAllData(
          preview.token,
        );
        setBackup(undefined);
        setFileName("");
        setNotice(`雲端資料已清空：${formatCount(counts)}。`);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "雲端清空失敗，請重新預覽後再試。",
        );
      } finally {
        setBusy(false);
      }
      return;
    }

    if (
      !window.confirm(
        "即將清空此瀏覽器中的全部資料庫內容。\n\n包括：區域、地點、標籤、行程與每日行程項目。\n\n此操作無法撤銷，請先確認是否已備份。確定要清空嗎？",
      )
    ) {
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      await dataManagementController.clearAllData();
      setBackup(undefined);
      setFileName("");
      setNotice("資料庫已清空，所有旅遊資料已移除。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "清空資料失敗。");
    } finally {
      setBusy(false);
    }
  }

  async function handleTransferSupabaseToLocal() {
    if (
      !window.confirm(
        "即將用 Supabase 雲端資料庫覆蓋本機資料。\n\n此操作會以雲端目前內容取代本機內容，且無法從本程式復原。確定繼續嗎？",
      )
    ) {
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      const counts = await dataManagementController.transferSupabaseToLocal();
      setNotice(`已從 Supabase 匯回本機：${formatCount(counts)}。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "從 Supabase 匯回本機失敗。");
    } finally {
      setBusy(false);
    }
  }

  async function handleTransferLocalToSupabase() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { backup: localBackup, preview } =
        await dataManagementController.previewLocalToSupabaseTransfer();
      const previewDetail = formatPreviewCounts(preview.current, preview.incoming);
      if (
        !window.confirm(
          `即將用本機資料覆蓋目前登入帳號的雲端資料。\n\n${previewDetail}\n\n確認後會以本機資料取代目前帳號雲端資料。是否繼續？`,
        )
      ) {
        return;
      }

      const counts = await dataManagementController.transferLocalToSupabase(
        localBackup,
        preview.token,
      );
      setNotice(`已從本機覆蓋至雲端：${formatCount(counts)}。`);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "本機搬移至雲端失敗，請重新預覽後再試。",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <WorkspaceLayout
      active="data"
      shellClassName="data-management-shell"
      mainClassName="data-management-main"
    >
      <section className="data-management-content">
        <div className="data-management-heading">
          <div className="workspace-page-heading-title">
            <h1>資料</h1>
            <p>匯出可存取的旅行資料；單機模式可匯入備份或清空本機資料。</p>
          </div>
        </div>

        {canDebugModes && <section className="data-management-switcher" aria-label="管理員資料庫除錯設定">
          <label className="data-management-switcher-field">
            <span>資料庫來源</span>
            <select
              value={databaseMode}
              disabled={busy}
              onChange={handleDatabaseModeChange}
            >
              <option value="indexeddb">Dexie/IndexedDB（單機）</option>
              <option value="supabase">Supabase（雲端）</option>
              <option value="hybrid" disabled={!hybridStatus.ready}>混合模式（本機優先）</option>
            </select>
          </label>

          <label className="data-management-switcher-field">
            <span>同步模式</span>
            <select
              value={syncMode}
              disabled={busy}
              onChange={handleSyncModeChange}
            >
              <option value="manual">手動同步</option>
              <option value="auto">自動同步</option>
            </select>
          </label>
        </section>}

        {syncInfo.canConfigure && (
          <section className="data-management-card data-management-admin-info" aria-labelledby="admin-sync-info-heading">
            <div className="data-management-admin-info-heading">
              <h2 id="admin-sync-info-heading">管理員資訊顯示</h2>
              <span>僅管理員</span>
            </div>
            <label className="data-management-info-toggle">
              <input
                type="checkbox"
                role="switch"
                checked={syncInfo.visible}
                disabled={busy || Boolean(syncInfo.error)}
                onChange={(event) => {
                  try {
                    syncInfo.setVisible(event.target.checked);
                    setError("");
                    setNotice(event.target.checked ? "已顯示混合模式同步資訊。" : "已隱藏混合模式同步資訊，不影響同步功能。");
                  } catch (cause) {
                    setError(cause instanceof Error ? cause.message : "儲存資訊顯示設定失敗。");
                  }
                }}
              />
              <span>顯示資料模式與同步資訊</span>
            </label>
            <p>顯示各模組頁首的資料模式與儲存提示；混合模式另顯示待同步數量、失敗與衝突、最近同步時間及儲存耗時。關閉不影響同步與必要的錯誤提醒。設定依管理員帳號記住於此瀏覽器。</p>
            {syncInfo.error && <div className="data-management-feedback data-management-error" role="alert">無法讀取資訊顯示設定：{syncInfo.error}</div>}
          </section>
        )}

        {error && (
          <div
            className="data-management-feedback data-management-error"
            role="alert"
          >
            {error}
          </div>
        )}
        {notice && (
          <div
            className="data-management-feedback data-management-success"
            role="status"
          >
            {notice}
          </div>
        )}

        <div className="data-management-cards">
          {databaseMode === 'hybrid' && <HybridSyncPreview />}
          {databaseMode !== 'hybrid' && <section className="data-management-card data-management-transfer-card">
            <div className="data-management-card-icon">⇄</div>
            <h2>資料搬移</h2>
            <p>可在本機與雲端間執行帳號範圍內的覆蓋搬移。每次都會先預覽再確認。</p>
            <div className="data-management-actions data-management-transfer-actions">
              <button
                type="button"
                className="data-management-secondary"
                disabled={busy}
                onClick={() => void handleTransferLocalToSupabase()}
              >
                從本機覆蓋到 Supabase
              </button>
              <button
                type="button"
                className="data-management-secondary"
                disabled={busy}
                onClick={() => void handleTransferSupabaseToLocal()}
              >
                從 Supabase 匯回本機
              </button>
            </div>
          </section>}

          <section className="data-management-card">
            <div className="data-management-card-icon">↓</div>
            <h2>匯出備份</h2>
            <p>
              下載包含區域、地點、標籤、行程與每日行程項目的完整 JSON 備份。
            </p>
            <button
              type="button"
              className="data-management-primary"
              disabled={busy}
              onClick={() => void handleExport()}
            >
              {busy ? "處理中…" : "匯出所有資料"}
            </button>
          </section>

          {databaseMode !== 'hybrid' && <section className="data-management-card data-management-import-card">
            <div className="data-management-card-icon">↑</div>
            <h2>匯入並覆蓋</h2>
            <p>
              {databaseMode === "supabase"
                ? "只覆蓋目前登入帳號在雲端的資料。會先顯示預覽數量，再由你確認。"
                : "只接受格式正確、版本相容且資料關聯完整的本程式備份。驗證通過後才會替換現有資料。"}
            </p>
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
              <button
                type="button"
                className="data-management-secondary"
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
              >
                選擇備份檔
              </button>
              {backup && (
                <button
                  type="button"
                  className="data-management-danger"
                  disabled={busy}
                  onClick={() => void handleImport()}
                >
                  {busy
                    ? "匯入中…"
                    : databaseMode === "supabase"
                      ? "確認覆蓋雲端資料"
                      : "確認覆蓋匯入"}
                </button>
              )}
            </div>
            {backup && (
              <p className="data-management-selected-file">
                已驗證：{fileName}
              </p>
            )}
            <div className="data-management-warning" role="note">
              {databaseMode === "supabase"
                ? "雲端覆蓋只作用於目前登入帳號，且會檢查預覽快照是否過期。"
                : "匯入會取代此瀏覽器的全部旅行資料，不會合併。請確認已選對備份檔，並先匯出目前資料以免遺失。"}
            </div>
          </section>}

          {databaseMode !== 'hybrid' && <section className="data-management-card data-management-import-card">
            <div className="data-management-card-icon">⌫</div>
            <h2>清空資料庫</h2>
            <p>
              {databaseMode === "supabase"
                ? "清空目前登入帳號在雲端的資料。會先預覽並確認後才執行。"
                : "將此瀏覽器中所有旅行資料一次性刪除，包括區域、地點、標籤、行程與每日行程項目。"}
            </p>
            <div className="data-management-actions">
              <button
                type="button"
                className="data-management-danger"
                disabled={busy}
                onClick={() => void handleClearAllData()}
              >
                {busy
                  ? "清空中…"
                  : databaseMode === "supabase"
                    ? "清空目前帳號雲端資料"
                    : "清空整個資料庫"}
              </button>
            </div>
            <div className="data-management-warning" role="note">
              {databaseMode === "supabase"
                ? "僅影響目前登入帳號，且會阻擋可能破壞分享/協作設定的情況。"
                : "這是破壞性操作，且不會保留可回復內容。建議先匯出備份後再執行。"}
            </div>
          </section>}
          {databaseMode === "supabase" && (
            <p role="note">雲端操作只作用於目前登入帳號，且採預覽確認與交易回滾保護。</p>
          )}
        </div>
      </section>
    </WorkspaceLayout>
  );
}

export default DataManagementModule;
