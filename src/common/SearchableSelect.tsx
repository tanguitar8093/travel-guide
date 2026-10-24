import { useRef, useState } from 'react'
import { SearchableSelectDialog } from './SearchableSelectDialog'
import './SearchableSelect.css'

export interface SearchableOption {
  id: string; name: string; color?: string; depth?: number; disabled?: boolean; description?: string
}

type SelectProps = { label: string; placeholder: string; options: SearchableOption[]; disabled: boolean }

export function SearchableSelect({ label, placeholder, options, value, onChange, disabled }: SelectProps & {
  value: string; onChange(value: string): void
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  function close() { setOpen(false); trigger.current?.focus() }
  return <div className="searchable-select">
    <button ref={trigger} type="button" className="searchable-select-trigger" aria-label={label} aria-haspopup="dialog"
      aria-expanded={open} disabled={disabled} onClick={() => setOpen(true)}>
      <span>{options.find(option => option.id === value)?.name ?? placeholder}</span><span aria-hidden="true">⌄</span>
    </button>
    {open && <SearchableSelectDialog label={label} options={options} value={value} onChange={onChange} onClose={close} disabled={disabled} />}
  </div>
}

export function SearchableMultiSelect({ label, placeholder, options, selectedIds, onToggle, disabled }: SelectProps & {
  selectedIds: string[]; onToggle(id: string): void
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const selected = options.filter(option => selectedIds.includes(option.id))
  function close() { setOpen(false); trigger.current?.focus() }
  return <div className="searchable-select">
    <button ref={trigger} type="button" className="searchable-select-trigger" aria-label={label} aria-haspopup="dialog"
      aria-expanded={open} disabled={disabled} onClick={() => setOpen(true)}>
      <span>{selected.length ? `已選 ${selected.length} 個` : placeholder}</span><span aria-hidden="true">⌄</span>
    </button>
    {!!selected.length && <div className="searchable-selected-choices" aria-label={`已選${label}`}>
      {selected.map(option => <span key={option.id}>{option.name}<button type="button" aria-label={`移除${option.name}`} disabled={disabled} onClick={() => onToggle(option.id)}>×</button></span>)}
    </div>}
    {open && <SearchableSelectDialog label={label} options={options} selectedIds={selectedIds} onToggle={onToggle} onClose={close} disabled={disabled} />}
  </div>
}
