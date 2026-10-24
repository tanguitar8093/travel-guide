import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { SearchableOption } from './SearchableSelect'
import './SelectionSearchPicker.css'

export function SelectionSearchPicker({ label, options, value = '', onChange, disabled = false, selectedIds, onToggle, autoFocus = false }: {
  label: string; options: SearchableOption[]; value?: string; onChange?(id: string): void;
  disabled?: boolean; selectedIds?: string[]; onToggle?(id: string): void; autoFocus?: boolean
}) {
  const id = useId()
  const [mode, setMode] = useState<'select' | 'search'>('select')
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const multiple = selectedIds !== undefined
  const selected = new Set(selectedIds ?? [value])
  const normalized = mode === 'search' ? query.trim().toLocaleLowerCase() : ''
  const filtered = options.filter(option => option.name.toLocaleLowerCase().includes(normalized))

  useEffect(() => {
    if (autoFocus) list.current?.focus()
  }, [autoFocus])
  useEffect(() => {
    if (mode === 'search') input.current?.focus()
  }, [mode])
  useEffect(() => {
    if (activeIndex >= 0) document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, id])

  function choose(option: SearchableOption) {
    if (disabled || option.disabled) return
    if (multiple) onToggle?.(option.id)
    else onChange?.(option.id)
  }
  function handleKeys(event: KeyboardEvent<HTMLElement>) {
    if (disabled) return
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      if (mode === 'search' && ['Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const direction = event.key === 'ArrowUp' || event.key === 'End' ? -1 : 1
      let next = event.key === 'Home' ? 0 : event.key === 'End' ? filtered.length - 1
        : activeIndex < 0 ? (direction === 1 ? 0 : filtered.length - 1) : activeIndex + direction
      while (next >= 0 && next < filtered.length && filtered[next].disabled) next += direction
      if (next >= 0 && next < filtered.length) setActiveIndex(next)
    } else if (event.key === 'Enter' || (mode === 'select' && event.key === ' ')) {
      event.preventDefault()
      if (filtered[activeIndex]) choose(filtered[activeIndex])
    }
  }
  function switchMode(next: typeof mode) {
    setMode(next)
    setActiveIndex(-1)
    if (next === 'select') { input.current?.blur(); setQuery(''); requestAnimationFrame(() => list.current?.focus()) }
  }

  return <div className="selection-search-picker">
    <div className="selection-search-tabs" role="tablist" aria-label={`${label}選取方式`}>
      {(['select', 'search'] as const).map((tab, index) => <button key={tab} id={`${id}-${tab}-tab`} type="button" role="tab"
        aria-selected={mode === tab} aria-controls={`${id}-panel`} tabIndex={mode === tab ? 0 : -1} disabled={disabled}
        onClick={() => switchMode(tab)} onKeyDown={event => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault(); const next = index === 0 ? 'search' : 'select'
            switchMode(next); document.getElementById(`${id}-${next}-tab`)?.focus()
          }
        }}>
        <svg viewBox="0 0 20 20" aria-hidden="true">{tab === 'select'
          ? <path d="M7 5h10M7 10h10M7 15h10M3 5h.01M3 10h.01M3 15h.01" />
          : <><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></>}</svg>
        {tab === 'select' ? '選擇' : '搜尋'}
      </button>)}
    </div>
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${mode}-tab`}>
      {mode === 'search' && <input ref={input} className="selection-search-input" type="text" role="combobox" aria-label={`搜尋${label}`}
        aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-options`}
        aria-activedescendant={activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
        placeholder={`搜尋${label}`} autoComplete="off" value={query} disabled={disabled}
        onChange={event => { setQuery(event.target.value); setActiveIndex(-1) }} onKeyDown={handleKeys} />}
      <div className="selection-search-count"><span>{mode === 'search' && query ? '符合' : '全部'} {filtered.length} 個選項</span>{multiple && <span>已選 {selectedIds.length} 個</span>}</div>
      <ul ref={list} id={`${id}-options`} className="selection-search-options" role="listbox" aria-label={label}
        aria-multiselectable={multiple || undefined} aria-disabled={disabled || undefined} tabIndex={mode === 'select' ? 0 : -1}
        aria-activedescendant={activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined} onKeyDown={handleKeys}>
        {filtered.map((option, index) => <li key={option.id} id={`${id}-option-${index}`} role="option"
          aria-selected={selected.has(option.id)} aria-disabled={disabled || option.disabled || undefined}
          className={activeIndex === index ? 'active' : undefined}
          style={{ paddingInlineStart: 12 + (option.depth ?? 0) * 12 }}
          onMouseDown={event => event.preventDefault()} onClick={() => choose(option)}>
          {option.color && <i className="selection-search-color" style={{ backgroundColor: option.color }} aria-hidden="true" />}
          <span className="selection-search-name">{option.name}{option.description && <small>{option.description}</small>}</span>
          <span className={`selection-search-check${multiple ? ' multiple' : ''}`} aria-hidden="true">{selected.has(option.id) ? '✓' : ''}</span>
        </li>)}
        {!filtered.length && <li className="selection-search-empty" role="presentation">{options.length ? '找不到符合的選項' : '目前沒有可選項目'}</li>}
      </ul>
    </div>
  </div>
}
