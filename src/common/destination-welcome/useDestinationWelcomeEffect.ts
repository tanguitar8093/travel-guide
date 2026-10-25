import { useEffect, useRef, useState } from 'react'
import type { OsmDatasetId } from '../../geo/osm-datasets'
import { destinationWelcomeSound } from './sounds'

// A user-triggered decoration. It never changes authentication or workspace readiness.
export function useDestinationWelcomeEffect() {
  const [dataset, setDataset] = useState<OsmDatasetId>()
  const audioRef = useRef<HTMLAudioElement | null>(null)

  function close() {
    const audio = audioRef.current
    audioRef.current = null
    if (audio) {
      audio.onended = null
      audio.onerror = null
      audio.pause()
    }
    setDataset(undefined)
  }

  function play(next: OsmDatasetId) {
    close()
    const audio = new Audio(destinationWelcomeSound(next))
    audioRef.current = audio
    const finish = () => { if (audioRef.current === audio) close() }
    audio.onended = finish
    audio.onerror = finish
    setDataset(next)
    // Start inside the click gesture, so playback does not depend on autoplay.
    void audio.play().catch(finish)
  }

  useEffect(() => () => {
    const audio = audioRef.current
    audioRef.current = null
    if (audio) {
      audio.onended = null
      audio.onerror = null
      audio.pause()
    }
  }, [])

  return { play, dataset, close }
}

