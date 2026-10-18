import { useEffect, useId, useRef, useState } from 'react'
import type { Place } from '../../database'
import { SearchableSelect } from '../../common/SearchableSelect'
import type { RouteCalculatorController } from './route-calculator.controller'
import type { RouteEndpoint } from './route-calculator.service'

interface RouteEndpointFieldProps {
  label: string
  places: Place[]
  value: RouteEndpoint | null
  onChange: (endpoint: RouteEndpoint | null) => void
  disabled: boolean
  autoFocus?: boolean
  controller: RouteCalculatorController
  source: RouteEndpoint['source']
  onSourceChange: (source: RouteEndpoint['source']) => void
}

export function RouteEndpointField({
  label, places, value, onChange, disabled, autoFocus = false,
  controller, source, onSourceChange,
}: RouteEndpointFieldProps) {
  const id = useId()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const container = useRef<HTMLDivElement>(null)
  const configured = controller.isGooglePlacesConfigured()

  useEffect(() => {
    if (source !== 'google' || !configured || !container.current) return
    let active = true
    let destroy: (() => void) | undefined
    const host = document.createElement('div')
    container.current.replaceChildren(host)
    setLoading(true)
    setError('')
    void controller.mountAutocomplete(
      host,
      (place) => { if (active) { setError(''); onChange({ source: 'google', place }) } },
      (cause) => { if (active) { setError(cause.message); onChange(null) } },
      { label: `${label} Google 搜尋`, onInput: () => { if (active) onChange(null) } },
    ).then((cleanup) => {
      if (!active) { cleanup(); return }
      destroy = cleanup
      setLoading(false)
      host.querySelector<HTMLElement>('gmp-place-autocomplete')?.focus()
    }).catch((cause: unknown) => {
      if (active) {
        setLoading(false)
        setError(cause instanceof Error ? cause.message : 'Google 搜尋載入失敗。')
      }
    })
    return () => { active = false; destroy?.(); host.remove() }
  }, [source, configured, onChange, label, attempt, controller])

  return (
    <fieldset className="route-endpoint" disabled={disabled}>
      <legend>{label} <b>*</b></legend>
      <div className="route-source-switch" role="group" aria-label={`${label}來源`}>
        <button
          type="button" aria-pressed={source === 'saved'}
          onClick={() => {
            if (source === 'saved') return
            onSourceChange('saved'); setError('')
          }}
        >已存地點</button>
        <button
          type="button" aria-pressed={source === 'google'}
          onClick={() => {
            if (source === 'google') return
            onSourceChange('google'); setError('')
          }}
        >Google 搜尋</button>
      </div>
      {source === 'saved' ? (
        <>
          <SearchableSelect
            inputId={id}
            label={`${label}：已存地點`}
            ariaRequired
            placeholder="搜尋或選擇地點"
            options={places.map((place) => ({
              id: place.id, name: place.name,
              disabled: !place.googlePlaceId,
              description: place.googlePlaceId ? undefined : '未設定 Google 地點，請改用 Google 搜尋',
            }))}
            value={value?.source === 'saved' ? value.placeId : ''}
            onChange={(placeId) => onChange({ source: 'saved', placeId })}
            onQueryChange={() => onChange(null)}
            disabled={disabled}
            autoFocus={autoFocus}
          />
          {!places.length && <p className="route-field-hint">目前沒有已存地點，可切換 Google 搜尋直接選擇。</p>}
        </>
      ) : (
        <>
          <div className="route-google-search" ref={container} inert={disabled} aria-busy={loading} />
          {loading && <p className="route-field-hint" role="status">載入 Google 搜尋中…</p>}
          {!configured && <p className="route-inline-error" role="alert">尚未設定 Google Maps API key，無法搜尋地點。</p>}
          {error && (
            <div className="route-inline-error" role="alert">
              {error} <button type="button" onClick={() => setAttempt((current) => current + 1)}>重試搜尋</button>
            </div>
          )}
          {value?.source === 'google' ? (
            <p className="route-selected-place">
              已選擇：{value.place.displayName ?? value.place.formattedAddress ?? 'Google 地點'}
              {value.place.formattedAddress && <small>{value.place.formattedAddress}</small>}
            </p>
          ) : <p className="route-field-hint">請從 Google 建議結果選取；只輸入文字不會作為計算地點。</p>}
        </>
      )}
    </fieldset>
  )
}
