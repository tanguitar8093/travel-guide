import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { database } from '../../database/database'
import { labels } from '../../database/label.repository'
import { places } from '../../database/repositories'

vi.mock('../../database', async () => ({
  ...await import('../../database/errors'),
  labels: (await import('../../database/label.repository')).labels,
  places: (await import('../../database/repositories')).places,
}))
vi.mock('../../database/runtime', () => ({
  getDatabaseMode: () => 'indexeddb',
  subscribeDatabaseMode: () => () => {},
}))

import { LabelService } from './label.service'
import { LabelController } from './label.controller'

const service = new LabelService()
const controller = new LabelController(service)
const createLabel = (name: string, parentId?: string) => labels.create({ name, color: '#123456', parentId })

beforeEach(async () => {
  vi.restoreAllMocks()
  await database.delete()
  await database.open()
})
afterAll(async () => { await database.delete() })

describe('label operation batch deletion', () => {
  it('deletes a normal selection once per ID through the controller and existing API', async () => {
    const first = await createLabel('美食')
    const second = await createLabel('景點')
    const untouched = await createLabel('保留')
    const deleteOne = vi.spyOn(service, 'delete')
    const list = vi.spyOn(labels, 'list')

    expect(await controller.deleteMany([first, second, first])).toEqual({
      deletedIds: [first, second], failures: [],
    })
    expect(deleteOne.mock.calls).toEqual([[first], [second]])
    expect(list).toHaveBeenCalledOnce()
    expect((await labels.list()).map((label) => label.id)).toEqual([untouched])
  })

  it('deletes selected descendants before parents without depending on input order', async () => {
    const parent = await createLabel('父標籤')
    const child = await createLabel('子標籤', parent)
    const grandchild = await createLabel('孫標籤', child)
    const deleteOne = vi.spyOn(service, 'delete')

    expect(await service.deleteMany([parent, child, grandchild, parent])).toEqual({
      deletedIds: [grandchild, child, parent], failures: [],
    })
    expect(deleteOne.mock.calls).toEqual([[grandchild], [child], [parent]])
    expect(await labels.list()).toEqual([])
  })

  it('reports blocked parents and assignments while preserving children, places and unrelated labels', async () => {
    const parent = await createLabel('有子標籤')
    const child = await createLabel('未選取的子標籤', parent)
    const assigned = await createLabel('已套用')
    const removable = await createLabel('可刪除')
    const untouched = await createLabel('未選取')
    const place = await places.create({ name: '餐廳', mapsUrl: 'https://maps.example.com', regionIds: [], labelIds: [assigned] })

    const result = await service.deleteMany([parent, assigned, removable])
    expect(result.deletedIds).toEqual([removable])
    expect(result.failures.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: parent, name: '有子標籤' }, { id: assigned, name: '已套用' },
    ])
    expect(result.failures[0].message).toContain('子標籤')
    expect(result.failures[1].message).toContain('地點')
    expect(new Set((await labels.list()).map((label) => label.id))).toEqual(new Set([parent, child, assigned, untouched]))
    expect((await places.getById(place))?.labelIds).toEqual([assigned])
  })

  it('retains a parent when its selected child fails and still deletes independent labels', async () => {
    const parent = await createLabel('父標籤')
    const child = await createLabel('已套用的子標籤', parent)
    const other = await createLabel('其他')
    await places.create({ name: '餐廳', mapsUrl: 'https://maps.example.com', regionIds: [], labelIds: [child] })

    const result = await service.deleteMany([parent, other, child])
    expect(result.deletedIds).toEqual([other])
    expect(result.failures.map((failure) => failure.id)).toEqual([child, parent])
    expect(await labels.getById(child)).toBeDefined()
    expect(await labels.getById(parent)).toBeDefined()
  })

  it('reports missing IDs once without preventing valid deletes', async () => {
    const valid = await createLabel('有效標籤')
    const result = await service.deleteMany(['missing', valid, 'missing'])
    expect(result.deletedIds).toEqual([valid])
    expect(result.failures).toEqual([{ id: 'missing', name: 'missing', message: '標籤「missing」不存在或已被刪除。' }])
  })
})