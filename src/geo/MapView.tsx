import { useEffect, useRef, useState } from 'react'
import type { MapHandle, MapMarker, MapMountOptions, MapRenderer } from './contracts'
import { toGeoError } from './errors'
import './map.css'

export interface MapViewProps {
  renderer: MapRenderer
  options: Omit<MapMountOptions, 'events' | 'signal'>
  markers: readonly MapMarker[]
  onSelect?(id: string): void
  onReady?(handle: MapHandle | null): void
}

export function MapView({ renderer, options, markers, onSelect, onReady }: MapViewProps) {
  const host = useRef<HTMLDivElement>(null)
  const handle = useRef<MapHandle | null>(null)
  const latest = useRef({ markers, onSelect, onReady })
  latest.current = { markers, onSelect, onReady }
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!host.current) return
    const container = host.current
    let active = true
    let owned: MapHandle | undefined
    const controller = new AbortController()
    const fail = (cause: unknown) => {
      if (!active) return
      setError(toGeoError(cause).message)
      setStatus('error')
      handle.current = null
      latest.current.onReady?.(null)
      owned?.destroy()
    }
    setStatus('loading')
    setError('')
    Promise.resolve().then(() => {
      if (!active) return undefined
      return renderer.mount(container, {
        ...options, signal: controller.signal,
        events: {
          onSelect: id => { if (active) latest.current.onSelect?.(id) },
          onError: fail,
        },
      })
    }).then(map => {
      if (!map) return
      if (!active) { map.destroy(); return }
      owned = map
      map.setMarkers(latest.current.markers)
      handle.current = map
      setStatus('ready')
      latest.current.onReady?.(map)
    }).catch(fail)
    return () => {
      active = false
      controller.abort()
      owned?.destroy()
      handle.current = null
      latest.current.onReady?.(null)
    }
  }, [renderer, options])

  useEffect(() => {
    try { handle.current?.setMarkers(markers) } catch (cause) {
      setError(toGeoError(cause).message)
      setStatus('error')
      handle.current?.destroy()
      handle.current = null
      latest.current.onReady?.(null)
    }
  }, [markers])

  return <section className="geo-map-view" aria-label="地圖" aria-busy={status === 'loading'}>
    <div ref={host} className="geo-map-host" />
    {status === 'loading' && <p className="geo-map-feedback" role="status">正在載入底圖…</p>}
    {status === 'error' && <p className="geo-map-feedback geo-map-error" role="alert">{error}</p>}
  </section>
}
