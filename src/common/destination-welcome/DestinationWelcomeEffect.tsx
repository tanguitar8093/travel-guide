import { useEffect, useRef } from 'react'
import type { OsmDatasetId } from '../../geo/osm-datasets'
import { DestinationWelcomePanel } from './DestinationWelcomePanel'
import './DestinationWelcomeEffect.css'

export function DestinationWelcomeEffect({ dataset, onClose }: { dataset: OsmDatasetId; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    const previous = document.activeElement
    dialog.showModal()
    return () => {
      dialog.close()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])
  return <dialog ref={ref} className="destination-welcome-effect" aria-label="旅行範圍迎賓動畫"
    onCancel={event => { event.preventDefault(); onClose() }}>
    <DestinationWelcomePanel dataset={dataset} />
    <button className="destination-welcome-skip" type="button" onClick={onClose} aria-label="略過迎賓動畫">×</button>
  </dialog>
}
