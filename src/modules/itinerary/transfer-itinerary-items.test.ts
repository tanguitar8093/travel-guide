import { expect, it, vi } from 'vitest'
import type { ItineraryItem, ItineraryItemChanges } from '../../database'
import type { NewScheduledItem } from './itinerary.service'
import { transferItineraryItems } from './transfer-itinerary-items'

const trip = { id: 'trip', startDate: '2026-10-25', endDate: '2026-10-28' }
const sourceDate = trip.startDate
const destination = '2026-10-26'
const item = (id: string, order: number, date = sourceDate): ItineraryItem => ({ id, order, date, tripId: trip.id, placeId: `place-${id}`,
  transport: 'WALKING', arrivalTime: '10:00', durationMinutes: 45, note: '預約 10:00', travelDurationMinutes: 30, travelDistanceMeters: 2000 })

function setup(initial: ItineraryItem[]) {
  let records = structuredClone(initial)
  const controller = {
    getAccess: vi.fn((): 'owner' | 'viewer' => 'owner'), beginEdit: vi.fn(),
    listItems: vi.fn(async () => structuredClone(records)),
    updateItem: vi.fn(async (id: string, changes: ItineraryItemChanges) => { records = records.map(row => row.id === id ? { ...row, ...changes } : row) }),
    addItem: vi.fn(async (input: NewScheduledItem) => {
      const id = `copy-${records.length}`
      const order = records.filter(row => row.date === input.date).reduce((max, row) => Math.max(max, row.order), -1) + 1
      records.push({ ...input, id, order }); return id
    }),
  }
  return { controller, records: () => records }
}

it('moves into an empty day starting at zero and preserves the original IDs and order', async () => {
  const { controller, records } = setup([item('b', 8), item('a', 2)])
  const result = await transferItineraryItems(controller, trip, sourceDate, ['b', 'a'], destination, 'move', vi.fn())
  expect(result.succeeded).toBe(2)
  expect(records().filter(row => row.date === sourceDate)).toHaveLength(0)
  expect(records().filter(row => row.date === destination).sort((a, b) => a.order - b.order).map(row => [row.id, row.order]))
    .toEqual([['a', 0], ['b', 1]])
})

it('appends a whole day after existing destination items, including gaps in their order numbers', async () => {
  const { controller, records } = setup([item('a', 0), item('b', 1), item('existing', 12, destination)])
  await transferItineraryItems(controller, trip, sourceDate, ['a', 'b'], destination, 'move', vi.fn())
  expect(records().find(row => row.id === 'existing')?.order).toBe(12)
  expect(records().find(row => row.id === 'a')).toMatchObject({ date: destination, order: 13 })
  expect(records().find(row => row.id === 'b')).toMatchObject({ date: destination, order: 14 })
})

it('copies one item, keeps the entire original and metadata, and omits IDs and old route estimates from the new record', async () => {
  const original = item('a', 0)
  const { controller, records } = setup([original, item('existing', 5, destination)])
  await transferItineraryItems(controller, trip, sourceDate, ['a'], destination, 'copy', vi.fn())
  expect(records().find(row => row.id === 'a')).toEqual(original)
  const copied = records().find(row => row.id.startsWith('copy-'))!
  expect(copied).toMatchObject({ placeId: original.placeId, date: destination, order: 6, arrivalTime: '10:00', durationMinutes: 45, transport: 'WALKING', note: '預約 10:00' })
  expect(copied.travelDurationMinutes).toBeUndefined()
  expect(copied.travelDistanceMeters).toBeUndefined()
})

it('copies a whole day into an empty day in its original order, leaving the source intact', async () => {
  const originals = [item('b', 3), item('a', 1)]
  const { controller, records } = setup(originals)
  await transferItineraryItems(controller, trip, sourceDate, ['b', 'a'], destination, 'copy', vi.fn())
  expect(records().filter(row => row.date === sourceDate)).toEqual(originals)
  expect(records().filter(row => row.date === destination).map(row => [row.placeId, row.order])).toEqual([['place-a', 0], ['place-b', 1]])
})

it('reports partial failures without deleting or recreating the failed source item', async () => {
  const { controller, records } = setup([item('a', 0), item('b', 1)])
  controller.updateItem.mockRejectedValueOnce(new Error('衝突，請重新整理'))
  const result = await transferItineraryItems(controller, trip, sourceDate, ['a', 'b'], destination, 'move', vi.fn())
  expect(result.succeeded).toBe(1)
  expect(result.failures.map(failure => failure.job.id)).toEqual(['a'])
  expect(records().find(row => row.id === 'a')?.date).toBe(sourceDate)
  expect(records().find(row => row.id === 'b')).toMatchObject({ date: destination, order: 0 })
})

it.each([sourceDate, '2026-10-24', '2026-10-29', '2026-02-30', 'invalid'])('rejects invalid or unchanged target date %s before writing', async date => {
  const { controller } = setup([item('a', 0)])
  await expect(transferItineraryItems(controller, trip, sourceDate, ['a'], date, 'move', vi.fn())).rejects.toThrow()
  expect(controller.updateItem).not.toHaveBeenCalled()
  expect(controller.addItem).not.toHaveBeenCalled()
})

it('rejects stale source selection and viewer access without writing', async () => {
  const { controller } = setup([item('a', 0, destination)])
  await expect(transferItineraryItems(controller, trip, sourceDate, ['a'], '2026-10-27', 'move', vi.fn())).rejects.toThrow('來源行程已變更')
  controller.getAccess.mockReturnValue('viewer')
  await expect(transferItineraryItems(controller, trip, sourceDate, ['a'], destination, 'copy', vi.fn())).rejects.toThrow('權限')
  expect(controller.updateItem).not.toHaveBeenCalled()
  expect(controller.addItem).not.toHaveBeenCalled()
})
