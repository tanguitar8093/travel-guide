import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { SyncConflictReview } from '../../database/sync.types'
import { ConflictRecordValue, ConflictRecordTitle } from './ConflictRecordValue'

function preview(): SyncConflictReview {
  const item = { id: 'item-id', tripId: 'trip-id', placeId: 'place-id', date: '2026-10-17', order: 2 }
  return {
    id: 'workspace', token: 'token', createdAt: '2026-10-18', cursor: '0',
    localFingerprint: '', cloudFingerprint: '', pendingOperations: 1, localChoiceChanges: [],
    rows: [{ entity: 'itineraryItems', id: item.id, local: item, cloud: item }],
    localNames: [
      { entity: 'trips', id: 'trip-id', name: '京都之旅' },
      { entity: 'places', id: 'place-id', name: '本機咖啡店' },
      { entity: 'labels', id: 'label-id', name: '美食' },
      { entity: 'regions', id: 'region-id', name: '京都' },
    ],
    cloudRecords: [
      { entity: 'trips', id: 'trip-id', version: '1', record: { id: 'trip-id', name: '雲端行程', regionId: 'region-id', startDate: '2026-10-17', endDate: '2026-10-18' } },
      { entity: 'places', id: 'place-id', version: '1', record: { id: 'place-id', name: '雲端咖啡店', regionIds: ['region-id'], labelIds: [] } },
    ],
  }
}

function render(review: SyncConflictReview, field: string, side: 'local' | 'cloud' = 'local') {
  return renderToStaticMarkup(<ConflictRecordValue review={review} row={review.rows[0]} side={side} field={field} />)
}

describe('readable conflict comparison', () => {
  it('shows each side’s own trip and place names with expandable IDs', () => {
    const review = preview()
    expect(render(review, 'tripId')).toContain('京都之旅')
    expect(render(review, 'tripId', 'cloud')).toContain('雲端行程')
    expect(render(review, 'placeId')).toContain('本機咖啡店')
    expect(render(review, 'placeId', 'cloud')).toContain('雲端咖啡店')
    expect(render(review, 'placeId')).toContain('<details><summary>查看 ID</summary><small>place-id</small></details>')
    expect(renderToStaticMarkup(<ConflictRecordTitle review={review} row={review.rows[0]} />)).toBe('京都之旅／2026-10-17／本機咖啡店')
    expect(render(review, 'id')).toContain('京都之旅／2026-10-17／本機咖啡店')
  })

  it('supports region/label lists and parent label references', () => {
    const review = preview()
    review.rows = [{ entity: 'places', id: 'p', local: { id: 'p', name: '店', regionIds: ['region-id'], labelIds: ['label-id'] }, cloud: null }]
    expect(render(review, 'regionIds')).toContain('京都')
    expect(render(review, 'labelIds')).toContain('美食')
    review.rows = [{ entity: 'labels', id: 'child', local: { id: 'child', name: '子標籤', color: '#ff0000', parentId: 'label-id' }, cloud: null }]
    expect(render(review, 'parentId')).toContain('美食')
  })

  it('never substitutes the opposite side’s name when missing or deleted; supports old saved previews', () => {
    const review = preview()
    delete review.localNames
    expect(render(review, 'placeId')).toContain('找不到名稱')
    expect(render(review, 'placeId')).not.toContain('雲端咖啡店')
    expect(render(review, 'placeId')).toContain('place-id')
    review.rows.push({ entity: 'places', id: 'place-id', local: null, cloud: null })
    expect(render(review, 'placeId', 'cloud')).toContain('找不到名稱')
  })

  it('keeps unset and numeric fields readable and escapes names', () => {
    const review = preview()
    expect(render(review, 'travelDurationMinutes')).toBe('未設定')
    expect(render(review, 'order')).toBe('2')
    expect(render(review, 'date')).toBe('2026-10-17')
    review.localNames![1].name = '<script>alert(1)</script>'
    expect(render(review, 'placeId')).not.toContain('<script>')
    expect(render(review, 'placeId')).toContain('&lt;script&gt;')
  })
})