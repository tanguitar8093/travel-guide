import type { ItineraryItem } from '../../database'
import type { Coordinate } from '../../geo/contracts'
import type { GoogleMapMarkerData } from '../place/google-places.service'
import { runDayJobs } from './day-route-operations'

type RouteStop = Pick<ItineraryItem, 'placeId' | 'transport'>
type Route = (origin: Coordinate, destination: Coordinate, transport: string, signal: AbortSignal) => Promise<{ geometry?: Coordinate[][] }>

export async function buildDayRouteGeometry(items: readonly RouteStop[], markers: readonly GoogleMapMarkerData[], signal: AbortSignal, route: Route) {
  const positions = new Map(markers.map(marker => [marker.id, { latitude: marker.position.lat, longitude: marker.position.lng }]))
  const segments: Coordinate[][][] = Array.from({ length: Math.max(0, items.length - 1) }, () => [])
  const jobs = items.slice(1).map((destination, index) => ({ origin: items[index], destination, index }))
  const result = await runDayJobs(jobs, async ({ origin, destination, index }) => {
    signal.throwIfAborted()
    const from = positions.get(origin.placeId)
    const to = positions.get(destination.placeId)
    if (!from || !to) throw new Error('缺少座標')
    // A leg belongs to its destination. The first stop never needs a travel mode.
    if (!destination.transport || !['DRIVING', 'WALKING', 'BICYCLING'].includes(destination.transport)) throw new Error('缺少支援的交通方式')
    if (from.latitude === to.latitude && from.longitude === to.longitude) return
    const result = await route(from, to, destination.transport, signal)
    signal.throwIfAborted()
    if (!result.geometry?.length) throw new Error('無可用路線')
    segments[index] = result.geometry
  }, 3, () => {})
  signal.throwIfAborted()
  return { lines: segments.flat(), skipped: result.failures.length, total: jobs.length }
}
