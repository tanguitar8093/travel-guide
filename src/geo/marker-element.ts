import type { MapMarker } from './contracts'

export function createMarkerElement(marker: MapMarker, onSelect?: (id: string) => void) {
  const element = document.createElement('button')
  element.type = 'button'
  element.className = 'geo-marker'
  element.title = marker.name
  element.setAttribute('aria-label', marker.name)
  element.setAttribute('aria-pressed', String(Boolean(marker.selected)))
  element.textContent = marker.sequence === undefined ? '' : String(marker.sequence)
  element.style.backgroundColor = marker.color ?? '#648a74'
  if (marker.selected) element.classList.add('geo-marker-selected')
  const select = () => onSelect?.(marker.id)
  element.addEventListener('click', select)
  return { element, dispose: () => element.removeEventListener('click', select) }
}
