import type { Label } from '../../database'
import type { BulkOperationResult } from '../../common/bulk-operation'
import '../../common/BulkDeleteToolbar.css'

export function BulkLabelToolbar({
  count, hiddenCount, disabled, canSelect, labels, labelId,
  onLabelChange, onSelectAll, onClear, onApply, onExit, result,
}: {
  count: number
  hiddenCount: number
  disabled: boolean
  canSelect: boolean
  labels: Label[]
  labelId: string
  onLabelChange: (id: string) => void
  onSelectAll: () => void
  onClear: () => void
  onApply: () => void
  onExit: () => void
  result?: BulkOperationResult
}) {
  return (
    <div className="bulk-delete-toolbar" aria-label="批次套用地點標籤">
      <span role="status">
        已選 {count} 筆
        {hiddenCount > 0 && `（${hiddenCount} 筆不在目前結果中）`}
      </span>
      <div className="bulk-delete-controls">
        <button type="button" disabled={disabled || !canSelect} onClick={onSelectAll}>全選</button>
        <button type="button" disabled={disabled || !count} onClick={onClear}>清除選取</button>
      </div>
      <label className="bulk-label-field">
        <span>套用同一標籤</span>
        <select value={labelId} disabled={disabled || !labels.length} onChange={(event) => onLabelChange(event.target.value)}>
          <option value="">選擇要套用的標籤…</option>
          {labels.map((label) => <option key={label.id} value={label.id}>{label.name}</option>)}
        </select>
      </label>
      <div className="bulk-delete-controls">
        <button type="button" disabled={disabled || !count || !labels.some((label) => label.id === labelId)} onClick={onApply}>
          {disabled ? '處理中…' : `套用標籤（${count}）`}
        </button>
        <button type="button" disabled={disabled} onClick={onExit}>取消</button>
      </div>
      <p>保留原有標籤，已套用的標籤不會重複新增。</p>
      {!labels.length && <p>尚無標籤，請先至標籤模組建立。</p>}
      {result && (
        <div role={result.failures.length ? 'alert' : 'status'}>
          <p>成功套用 {result.succeededIds.length} 筆，失敗 {result.failures.length} 筆。{result.failures.length > 0 && '失敗項目保留選取。'}</p>
          {result.failures.length > 0 && (
            <ul>{result.failures.map((failure) => <li key={failure.id}>{failure.message}</li>)}</ul>
          )}
        </div>
      )}
    </div>
  )
}
