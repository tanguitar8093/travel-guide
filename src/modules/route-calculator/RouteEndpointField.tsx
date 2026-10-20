import { useEffect, useId, useRef, useState } from 'react'
import type { Place } from '../../database'
import { SearchableSelect } from '../../common/SearchableSelect'
import type { RouteCalculatorController } from './route-calculator.controller'
import type { RouteEndpoint, RouteMapPlace } from './route-calculator.service'

interface RouteEndpointFieldProps {
  label: string
  places: Place[]
  addedMarkers: RouteMapPlace[]
  value: RouteEndpoint | null
  onChange: (endpoint: RouteEndpoint | null) => void
  disabled: boolean
  controller: RouteCalculatorController
}

type SavedChoice =
  | { kind: 'place'; placeId: string }
  | { kind: 'marker'; googlePlaceId: string }

export function RouteEndpointField({
  label, places, addedMarkers, value, onChange, disabled, controller,
}: RouteEndpointFieldProps) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const [dialogSource, setDialogSource] = useState<'saved' | 'google' | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const container = useRef<HTMLDivElement>(null)
  const configured = controller.isGooglePlacesConfigured()
  const savedGooglePlaceIds = new Set(
    places.flatMap((place) => place.googlePlaceId ? [place.googlePlaceId] : []),
  )
  const uniqueAddedMarkers = addedMarkers.filter(
    (marker) => !savedGooglePlaceIds.has(marker.googlePlaceId),
  )
  const savedChoices = new Map<string, SavedChoice>()
  const options = [
    ...places.map((place) => {
      const optionId = `place:${place.id}`
      savedChoices.set(optionId, { kind: 'place', placeId: place.id })
      return {
        id: optionId,
        name: place.name,
        disabled: !place.googlePlaceId,
        description: place.googlePlaceId ? undefined : '未設定 Google 地點，無法用於試算',
      }
    }),
    ...uniqueAddedMarkers.map((marker) => {
      const optionId = `marker:${marker.googlePlaceId}`
      savedChoices.set(optionId, { kind: 'marker', googlePlaceId: marker.googlePlaceId })
      return {
        id: optionId,
        name: marker.name,
        description: '後加標記',
      }
    }),
  ]
  const selectedPlace = value?.source === 'saved'
    ? places.find((place) => place.id === value.placeId)
    : value?.source === 'google'
      ? places.find((place) => place.googlePlaceId === value.place.id)
      : undefined
  const selectedMarker = value?.source === 'google'
    ? uniqueAddedMarkers.find((marker) => marker.googlePlaceId === value.place.id)
    : undefined
  const selectedName = selectedPlace?.name
    ?? selectedMarker?.name
    ?? (value?.source === 'google'
      ? value.place.displayName ?? value.place.formattedAddress ?? 'Google 地點'
      : '')

  useEffect(() => {
    if (dialogSource !== 'google' || !configured || !container.current) return
    let active = true
    let destroy: (() => void) | undefined
    const host = document.createElement('div')
    container.current.replaceChildren(host)
    setLoading(true)
    setError('')
    void controller.mountAutocomplete(
      host,
      (place) => {
        if (!active) return
        setError('')
        onChange({ source: 'google', place })
        setDialogSource(null)
        trigger.current?.focus()
      },
      (cause) => {
        if (active) {
          setError(cause.message)
          onChange(null)
        }
      },
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
  }, [dialogSource, configured, onChange, label, attempt, controller])

  useEffect(() => {
    if (!dialogSource) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDialogSource(null)
        trigger.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [dialogSource])

  function closeDialog() {
    setDialogSource(null)
    trigger.current?.focus()
  }

  function selectSavedChoice(choiceId: string) {
    const choice = savedChoices.get(choiceId)
    if (!choice) return
    setError('')
    if (choice.kind === 'place') {
      onChange({ source: 'saved', placeId: choice.placeId })
    } else {
      onChange({ source: 'google', place: { id: choice.googlePlaceId } })
    }
    closeDialog()
  }

  return (
    <fieldset className="route-endpoint" disabled={disabled}>
      <legend>{label} <b>*</b></legend>
      <button
        ref={trigger}
        className="route-endpoint-trigger"
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        onClick={() => {
          setError('')
          setDialogSource('saved')
        }}
      >
        <span>{selectedName || `選擇${label}`}</span>
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="8" cy="8" r="5" />
          <path d="m12 12 5 5" />
        </svg>
      </button>
      {error && <p className="route-inline-error" role="alert">{error}</p>}
      {dialogSource && (
        <div
          className="route-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog()
          }}
        >
          <section
            className="route-dialog route-endpoint-dialog panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${id}-title`}
          >
            <div className="route-dialog-heading">
              <div>
                <div className="route-dialog-kicker">{label}</div>
                <h2 id={`${id}-title`}>選擇{label}</h2>
              </div>
              <button className="route-dialog-close" type="button" aria-label="關閉" onClick={closeDialog}>×</button>
            </div>
            <div className="route-source-switch" role="group" aria-label={`${label}地點來源`}>
              <button
                type="button"
                aria-pressed={dialogSource === 'saved'}
                onClick={() => { setError(''); setDialogSource('saved') }}
              >已存地點</button>
              <button
                type="button"
                aria-pressed={dialogSource === 'google'}
                onClick={() => { setError(''); setDialogSource('google') }}
              >Google 搜尋</button>
            </div>
            {dialogSource === 'saved' ? (
              <div className="route-saved-choices">
                <SearchableSelect
                  inputId={`${id}-saved`}
                  label={`${label}：已存地點`}
                  placeholder="搜尋或選擇地點"
                  options={options}
                  value={
                    selectedPlace
                      ? `place:${selectedPlace.id}`
                      : selectedMarker
                        ? `marker:${selectedMarker.googlePlaceId}`
                        : ''
                  }
                  onChange={selectSavedChoice}
                  disabled={disabled}
                  autoFocus
                  ariaRequired
                />
                {!places.length && !uniqueAddedMarkers.length && (
                  <p className="route-field-hint">目前沒有可選地點，可切換 Google 搜尋直接選擇。</p>
                )}
                {!!uniqueAddedMarkers.length && (
                  <p className="route-field-hint">後加標記也可直接選作端點。</p>
                )}
              </div>
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
                <p className="route-field-hint">請從 Google 建議結果選取；只輸入文字不會作為計算地點。</p>
              </>
            )}
          </section>
        </div>
      )}
    </fieldset>
  )
}
