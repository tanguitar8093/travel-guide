import type { BulkOperationResult } from '../../common/bulk-operation'
import '../../common/BulkDeleteToolbar.css'

export function BulkColorToolbar({
  count, hiddenCount, disabled, canSelect, color, colors,
  onColorChange, onSelectAll, onClear, onApply, onExit, result,
}: {
  count: number
  hiddenCount: number
  disabled: boolean
  canSelect: boolean
  color: string
  colors: string[]
  onColorChange: (color: string) => void
  onSelectAll: () => void
  onClear: () => void
  onApply: () => void
  onExit: () => void
  result?: BulkOperationResult
}) {
  return (
    <div className="bulk-delete-toolbar" aria-label="批次更新標籤顏色">
      <span role="status">
        已選 {count} 筆
        {hiddenCount > 0 && `（${hiddenCount} 筆不在目前結果中）`}
      </span>
      <div className="bulk-delete-controls">
        <button type="button" disabled={disabled || !canSelect} onClick={onSelectAll}>全選</button>
        <button type="button" disabled={disabled || !count} onClick={onClear}>清除選取</button>
      </div>
      <fieldset className="bulk-color-picker" disabled={disabled}>
        <legend>套用同一顏色</legend>
        <div className="color-swatches">
          {colors.map((value) => (
            <button
              key={value}
              type="button"
              className={`color-swatch${value === color ? ' chosen' : ''}`}
              style={{ backgroundColor: value }}
              aria-label={`批次選擇顏色 ${value}`}
              aria-pressed={value === color}
              onClick={() => onColorChange(value)}
            />
          ))}
          <label className="custom-color-control" title="自訂顏色">
            <span>＋</span>
            <input type="color" aria-label="批次自訂標籤顏色" value={color} onChange={(event) => onColorChange(event.target.value)} />
          </label>
        </div>
        <span>{color}</span>
      </fieldset>
      <div className="bulk-delete-controls">
        <button type="button" disabled={disabled || !count} onClick={onApply}>
          {disabled ? '處理中…' : `套用顏色（${count}）`}
        </button>
        <button type="button" disabled={disabled} onClick={onExit}>取消</button>
      </div>
      <p>僅更新勾選的標籤，不會自動套用至子標籤。</p>
      {result && (
        <div role={result.failures.length ? 'alert' : 'status'}>
          <p>成功更新 {result.succeededIds.length} 筆，失敗 {result.failures.length} 筆。{result.failures.length > 0 && '失敗項目保留選取。'}</p>
          {result.failures.length > 0 && (
            <ul>{result.failures.map((failure) => <li key={failure.id}>{failure.message}</li>)}</ul>
          )}
        </div>
      )}
    </div>
  )
}
