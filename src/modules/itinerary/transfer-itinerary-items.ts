import type { Trip } from '../../database'
import type { ItineraryController } from './itinerary.controller'
import { runDayJobs } from './day-route-operations'

export type TransferKind = 'move' | 'copy'
type TransferController = Pick<ItineraryController, 'getAccess' | 'beginEdit' | 'listItems' | 'addItem' | 'updateItem'>

export async function transferItineraryItems(controller: TransferController, trip: Pick<Trip, 'id' | 'startDate' | 'endDate'>,
  sourceDate: string, ids: readonly string[], destination: string, kind: TransferKind, onProgress: (done: number) => void) {
  if (controller.getAccess(trip.id) === 'viewer') throw new Error('你沒有修改此行程的權限。')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(destination) || !Number.isFinite(Date.parse(destination)) ||
      new Date(destination).toISOString().slice(0, 10) !== destination || destination < trip.startDate || destination > trip.endDate) {
    throw new Error('請選擇旅程日期範圍內的目的日期。')
  }
  if (destination === sourceDate) throw new Error('請選擇不同的日期。')
  if (!ids.length || new Set(ids).size !== ids.length) throw new Error('請選擇要處理的行程項目。')
  controller.beginEdit(trip.id)
  const items = await controller.listItems(trip.id)
  const selected = new Set(ids)
  const source = items.filter(item => selected.has(item.id) && item.date === sourceDate && item.tripId === trip.id)
    .sort((a, b) => a.order - b.order)
  if (source.length !== ids.length) throw new Error('來源行程已變更，請重新載入後再試。')
  let nextOrder = items.filter(item => item.date === destination).reduce((max, item) => Math.max(max, item.order), -1) + 1
  // Sequential writes preserve source order and the latest shared-document revision.
  return runDayJobs(source, async item => {
    if (kind === 'move') {
      await controller.updateItem(item.id, { date: destination, order: nextOrder })
    } else {
      await controller.addItem({ tripId: trip.id, date: destination, placeId: item.placeId,
        arrivalTime: item.arrivalTime, durationMinutes: item.durationMinutes, transport: item.transport, note: item.note })
    }
    nextOrder++
  }, 1, onProgress)
}
