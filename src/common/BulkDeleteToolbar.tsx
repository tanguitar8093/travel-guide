import type { ReactNode } from "react";
import type { BulkDeleteResult } from "./bulk-delete";
import "./BulkDeleteToolbar.css";

export function BulkDeleteToolbar({
  active = true,
  onEnter,
  onExit,
  count,
  hiddenCount,
  disabled,
  canSelect,
  onSelectAll,
  onClear,
  onDelete,
  result,
  entryActions,
}: {
  active?: boolean;
  onEnter?: () => void;
  onExit?: () => void;
  count: number;
  hiddenCount: number;
  disabled: boolean;
  canSelect: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onDelete: () => void;
  result?: BulkDeleteResult;
  entryActions?: ReactNode;
}) {
  if (!active)
    return (
      <div className="bulk-delete-toolbar" aria-label="多選刪除">
        <div className="bulk-delete-controls">
          <button
            type="button"
            disabled={disabled || !canSelect}
            onClick={onEnter}
          >
            批次刪除
          </button>
          {entryActions}
        </div>
      </div>
    );
  return (
    <div className="bulk-delete-toolbar" aria-label="多選">
      <span role="status">
        已選 {count} 筆
        {hiddenCount > 0 && `（${hiddenCount} 筆不在目前結果中）`}
      </span>
      <div className="bulk-delete-controls">
        <button
          type="button"
          disabled={disabled || !canSelect}
          onClick={onSelectAll}
        >
          全選
        </button>
        <button type="button" disabled={disabled || !count} onClick={onClear}>
          清除選取
        </button>
        <button
          type="button"
          className="bulk-delete-danger"
          disabled={disabled || !count}
          onClick={onDelete}
        >
          {disabled ? "處理中…" : `刪除（${count}）`}
        </button>
        {onExit && (
          <button type="button" disabled={disabled} onClick={onExit}>
            取消
          </button>
        )}
      </div>
      {result && (
        <div role={result.failures.length ? "alert" : "status"}>
          <p>
            成功刪除 {result.deletedIds.length} 筆，失敗{" "}
            {result.failures.length} 筆。
            {result.failures.length > 0 && "失敗項目保留選取。"}
          </p>
          {result.failures.length > 0 && (
            <ul>
              {result.failures.map((failure) => (
                <li key={failure.id}>{failure.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
