import { expect, it, vi } from 'vitest'
import type { Coordinate } from '../../geo/contracts'
import { buildDayRouteGeometry } from './day-route-geometry'

const markers = ['a', 'b', 'c', 'd'].map((id, index) => ({ id, title: id, position: { lat: 26 + index / 10, lng: 127 + index / 10 } }))
const point = (index: number): Coordinate => ({ latitude: markers[index].position.lat, longitude: markers[index].position.lng })
const stops = [{ placeId: 'a' }, { placeId: 'b', transport: 'WALKING' }, { placeId: 'c', transport: 'DRIVING' }, { placeId: 'd', transport: 'BICYCLING' }]

it('never requests a leg before the first stop and uses each destination travel mode', async () => {
  const route = vi.fn(async (from: Coordinate, to: Coordinate) => ({ geometry: [[from, to]] }))
  const result = await buildDayRouteGeometry(stops, markers, new AbortController().signal, route)
  expect(route.mock.calls.map(call => call.slice(0, 3))).toEqual([
    [point(0), point(1), 'WALKING'], [point(1), point(2), 'DRIVING'], [point(2), point(3), 'BICYCLING'],
  ])
  expect(result).toEqual({ lines: [[point(0), point(1)], [point(1), point(2)], [point(2), point(3)]], skipped: 0, total: 3, errors: [], approximate: false })
})

it('retains the other legs when a middle leg has no route, without drawing a cross-stop shortcut', async () => {
  const route = vi.fn(async (from: Coordinate, to: Coordinate) => {
    if (from.latitude === point(1).latitude) throw new Error('這兩個點找不到路線')
    return { geometry: [[from, to]] }
  })
  expect(await buildDayRouteGeometry(stops, markers, new AbortController().signal, route))
    .toEqual({ lines: [[point(0), point(1)], [point(2), point(3)]], skipped: 1, total: 3, errors: ['這兩個點找不到路線'], approximate: false })
  expect(route).toHaveBeenCalledTimes(3)
})

it('skips only legs incident to a missing marker, and never joins nonadjacent stops', async () => {
  const route = vi.fn(async (from: Coordinate, to: Coordinate) => ({ geometry: [[from, to]] }))
  expect(await buildDayRouteGeometry(stops, markers.filter(marker => marker.id !== 'b'), new AbortController().signal, route))
    .toEqual({ lines: [[point(2), point(3)]], skipped: 2, total: 3, errors: ['缺少座標', '缺少座標'], approximate: false })
  expect(route).toHaveBeenCalledTimes(1)
})

it('skips unsupported or missing destination modes while keeping usable legs', async () => {
  const route = vi.fn(async (from: Coordinate, to: Coordinate) => ({ geometry: [[from, to]] }))
  const result = await buildDayRouteGeometry([stops[0], { placeId: 'b' }, { placeId: 'c', transport: 'TRANSIT' }, stops[3]], markers, new AbortController().signal, route)
  expect(result).toMatchObject({ skipped: 2, lines: [[point(2), point(3)]] })
})

it('does not publish stale geometry after cancellation', async () => {
  const abort = new AbortController()
  const route = vi.fn(async (from: Coordinate, to: Coordinate) => {
    abort.abort()
    return { geometry: [[from, to]] }
  })
  await expect(buildDayRouteGeometry(stops, markers, abort.signal, route)).rejects.toThrow()
})

it('allows a day with one stop without calling the route service', async () => {
  const route = vi.fn()
  expect(await buildDayRouteGeometry(stops.slice(0, 1), markers, new AbortController().signal, route)).toEqual({ lines: [], skipped: 0, total: 0, errors: [], approximate: false })
  expect(route).not.toHaveBeenCalled()
})


it('preserves a backend search-budget error instead of disguising it as a missing travel mode', async () => {
  const message = '此路段搜尋範圍過大或計算超過時限，請分段計算後重試。'
  const route = vi.fn(async () => { throw new Error(message) })
  const result = await buildDayRouteGeometry(stops.slice(0, 2), markers, new AbortController().signal, route)
  expect(result).toMatchObject({ lines: [], skipped: 1, total: 1, errors: [message] })
})


it('marks a day containing a bounded road estimate without losing its geometry', async () => {
  const result = await buildDayRouteGeometry(stops.slice(0, 2), markers, new AbortController().signal, async (from,to) => ({ geometry: [[from,to]], approximate: true }))
  expect(result).toMatchObject({ approximate: true, skipped: 0, lines: [[point(0),point(1)]] })
})
