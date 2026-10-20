import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { SearchableSelect } from './SearchableSelect'
import type { SearchableOption } from './SearchableSelect'
import './SearchableSelectDialog.css'

export function SearchableSelectDialog({
  label, options, value, onChange, onClose,
}: {
  label: string
  options: SearchableOption[]
  value: string
  onChange(value: string): void
  onClose(): void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    element?.querySelector<HTMLInputElement>('input')?.focus()
    return () => { element?.close() }
  }, [])

  return createPortal(
    <dialog ref={dialog} className="searchable-select-dialog" aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="searchable-select-dialog-content">
        <header>
          <h2 id={titleId}>選擇{label}</h2>
          <button type="button" aria-label="關閉地點搜尋" onClick={onClose}>×</button>
        </header>
        <SearchableSelect label={label} placeholder={`搜尋或選擇${label}`}
          options={options} value={value} disabled={false} autoFocus
          onChange={(id) => { onChange(id); onClose() }} />
      </div>
    </dialog>,
    document.body,
  )
}
