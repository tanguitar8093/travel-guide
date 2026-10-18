import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { database } from '../../database/database'
import { itineraryItems, places, regions, trips } from '../../database/repositories'

vi.mock('../../database', async () => ({
  ...await import('../../database/errors'),
  ...await import('../../database/repositories'),
  labels: (await import('../../database/label.repository')).labels,
}))
vi.mock('../../database/runtime', () => ({
  getDatabaseMode: () => 'indexeddb',
  subscribeDatabaseMode: () => () => {},
}))

import { PlaceService } from './place.service'
import { PlaceController } from './place.controller'

const service = new PlaceService()
const controller = new PlaceController(service)
const createPlace = (name: string) => places.create({ name, mapsUrl: 'https://maps.example.com', regionIds: [], labelIds: [] })

beforeEach(async () => {
  vi.restoreAllMocks()
  await database.delete()
  await database.open()
})
afterAll(async () => { await database.delete() })

describe('place operation batch deletion', () => {
  it('deletes a normal deduplicated selection through the controller and existing API', async () => {
    const first = await createPlace('餐廳')
    const second = await createPlace('公園')
    const untouched = await createPlace('保留')
    const deleteOne = vi.spyOn(service, 'delete')

    expect(await controller.deleteMany([first, second, first])).toEqual({
      deletedIds: [first, second], failures: [],
    })
    expect(deleteOne.mock.calls).toEqual([[first], [second]])
    expect((await places.list()).map((place) => place.id)).toEqual([untouched])
  })

  it('preserves itinerary references and blocked places while deleting other selected places', async () => {
    const first = await createPlace('可刪除一')
    const blocked = await createPlace('行程景點')
    const last = await createPlace('可刪除二')
    const untouched = await createPlace('未選取')
    const regionId = await regions.create({ name: '台北', googlePlaceId: 'taipei', zoom: 10 })
    const tripId = await trips.create({ name: '旅行', regionId, startDate: '2026-10-18', endDate: '2026-10-18' })
    const itemId = await itineraryItems.create({ tripId, placeId: blocked, date: '2026-10-18', order: 0 })

    const result = await service.deleteMany([first, blocked, last, blocked])
    expect(result.deletedIds).toEqual([first, last])
    expect(result.failures).toEqual([{
      id: blocked, name: '行程景點',
      message: '地點「行程景點」仍被行程項目引用，請先移除行程中的地點後再刪除。',
    }])
    expect(new Set((await places.list()).map((place) => place.id))).toEqual(new Set([blocked, untouched]))
    expect((await itineraryItems.getById(itemId))?.placeId).toBe(blocked)
    expect(await trips.getById(tripId)).toBeDefined()
  })

  it('reports a missing place once and continues after the failure', async () => {
    const valid = await createPlace('有效地點')
    expect(await service.deleteMany(['missing', valid, 'missing'])).toEqual({
      deletedIds: [valid],
      failures: [{ id: 'missing', name: 'missing', message: '地點「missing」不存在或已被刪除。' }],
    })
  })
})