import { useEffect, useRef, useState } from 'react'
import { mountOsmAutocomplete } from '../../geo/osm-service'
import type { OsmLocationCandidate } from '../../geo/osm-service'
import { PlaceSearchHeading } from './PlaceSearchHeading'

export function NewPlaceSearch({ disabled, onConfirm }: {
  disabled: boolean
  onConfirm(place: OsmLocationCandidate): void
}) {
  const host = useRef<HTMLDivElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const [selected, setSelected] = useState<OsmLocationCandidate>()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!host.current) return
    let active = true
    let cleanup: (() => void) | undefined
    setLoading(true)
    setError('')
    void mountOsmAutocomplete(host.current, place => {
      if (!active) return
      setSelected(place)
      setName(current => current || (place.location.source === 'osm' ? place.name : ''))
      setError('')
      nameInput.current?.focus()
    }, cause => { if (active) setError(cause.message) }, {
      label: '新地點搜尋',
      onInput: () => { if (active) { setSelected(undefined); setError('') } },
    }).then(dispose => {
      if (!active) { dispose(); return }
      cleanup = dispose
      setLoading(false)
      host.current?.querySelector<HTMLInputElement>('input')?.focus()
    }).catch(cause => {
      if (active) { setLoading(false); setError(cause instanceof Error ? cause.message : '搜尋載入失敗。') }
    })
    return () => { active = false; cleanup?.() }
  }, [attempt])
  return <div>
    <div className="route-new-search-title"><PlaceSearchHeading /></div>
    <div ref={host} inert={disabled} aria-busy={loading} />
    {loading && <p role="status" className="route-field-hint">載入搜尋中…</p>}
    <label className="route-new-place-name">
      <span>地點名稱（自行命名） <b>*</b></span>
      <input ref={nameInput} value={name} onChange={event => setName(event.target.value)} placeholder="例如：海邊停車場" maxLength={100} required disabled={disabled} />
    </label>
    {selected && <p className="route-field-hint">已選位置：{selected.location.coordinate.latitude}, {selected.location.coordinate.longitude}</p>}
    {error && <p className="route-inline-error" role="alert">{error} <button type="button" onClick={() => setAttempt(value => value + 1)}>重試搜尋</button></p>}
    <button type="button" className="route-primary" disabled={disabled || !selected || !name.trim()} onClick={() => { if (selected && name.trim()) onConfirm({ ...selected, name: name.trim() }) }}>使用此地點</button>
  </div>
}
