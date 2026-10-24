import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { SelectionSearchPicker } from './SelectionSearchPicker'
import type { SearchableOption } from './SearchableSelect'
import './SearchableSelectDialog.css'

export function SearchableSelectDialog({ label, options, value, onChange, onClose, selectedIds, onToggle, disabled = false }: {
  label: string; options: SearchableOption[]; value?: string; onChange?(value: string): void; onClose(): void;
  selectedIds?: string[]; onToggle?(id: string): void; disabled?: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element?.showModal()
    element?.querySelector<HTMLElement>('[role="listbox"]')?.focus()
    return () => { element?.close(); if (previousFocus?.isConnected) previousFocus.focus() }
  }, [])

  return createPortal(<dialog ref={dialog} className="searchable-select-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose() }}
    onClick={event => {
      if (event.target !== event.currentTarget) return
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
    }}>
    <div className="searchable-select-dialog-content">
      <header><h2 id={titleId}>{label.startsWith("選擇") ? label : `選擇${label}`}</h2><button type="button" aria-label={`關閉${label}選擇視窗`} onClick={onClose}>×</button></header>
      <SelectionSearchPicker label={label} options={options} value={value} disabled={disabled}
        selectedIds={selectedIds} onToggle={onToggle} onChange={id => { onChange?.(id); onClose() }} />
      {selectedIds !== undefined && <footer><button type="button" onClick={onClose}>完成</button></footer>}
    </div>
  </dialog>, document.body)
}
