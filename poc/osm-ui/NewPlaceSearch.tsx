import { useEffect, useRef, useState } from 'react'
import type { GooglePlaceDetails } from '../../src/modules/place/google-places.service'
import { PlaceSearchHeading } from './PlaceSearchHeading'
import type { RouteCalculatorController } from './controller'

export function NewPlaceSearch({ controller, disabled, onConfirm }: {
  controller: RouteCalculatorController
  disabled: boolean
  onConfirm(place: GooglePlaceDetails): void
}) {
  const host = useRef<HTMLDivElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const [selected, setSelected] = useState<GooglePlaceDetails>()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    if (!host.current) return
    let active = true
    let cleanup: (() => void) | undefined
    controller.mountAutocomplete(host.current, place => {
      if (!active) return
      setSelected(place)
      setName(current => current || (place.id.startsWith('coordinate:') ? '' : place.displayName || ''))
      setError('')
      nameInput.current?.focus()
    }, cause => { if (active) setError(cause.message) }, {
      label: '新地點搜尋', onInput: () => { if (active) { setSelected(undefined); setError('') } },
    }).then(dispose => { if (active) cleanup = dispose; else dispose() })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '搜尋載入失敗。') })
    return () => { active = false; cleanup?.() }
  }, [controller])
  return <div>
    <div style={{ marginBottom: 10 }}><PlaceSearchHeading title="新地點搜尋" /></div>
    <div ref={host} inert={disabled} />
    <label className="preview-new-place-name">
      <span>地點名稱（自行命名） <b>*</b></span>
      <input ref={nameInput} value={name} onChange={event => setName(event.target.value)} placeholder="例如：海邊停車場" maxLength={100} required disabled={disabled} />
    </label>
    {selected && <p className="route-field-hint">已選位置：{selected.location?.lat}, {selected.location?.lng}</p>}
    {error && <p className="route-inline-error" role="alert">{error}</p>}
    <button type="button" className="route-primary" disabled={disabled || !selected || !name.trim()} onClick={() => { if (selected && name.trim()) onConfirm({ ...selected, displayName: name.trim() }) }}>使用此地點</button>
  </div>
}
