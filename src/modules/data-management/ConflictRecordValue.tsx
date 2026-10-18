import type { SyncConflictReview, SyncEntityName, SyncRecord } from '../../database/sync.types'

type Side = 'local' | 'cloud'
type Row = SyncConflictReview['rows'][number]
const references: Record<string, SyncEntityName> = {
  tripId: 'trips', placeId: 'places', regionId: 'regions', regionIds: 'regions',
  labelIds: 'labels', parentId: 'labels',
  routeMapId: 'routeMaps',
}

function findName(review: SyncConflictReview, side: Side, entity: SyncEntityName, id: string): string | undefined {
  const row = review.rows.find((candidate) => candidate.entity === entity && candidate.id === id)
  // Names must come from the same side of this preview, not today's database
  // or the opposite side (which may have a different name or be deleted).
  if (row) return recordName(row[side])
  if (side === 'local') return review.localNames?.find((record) => record.entity === entity && record.id === id)?.name
  return recordName(review.cloudRecords.find((record) => record.entity === entity && record.id === id)?.record ?? null)
}

function recordName(record: SyncRecord | null): string | undefined {
  return record && 'name' in record ? record.name : undefined
}

function conflictRecordTitle(review: SyncConflictReview, row: Row, side: Side): string {
  const record = row[side]
  if (!record) return '已刪除／不存在'
  if ('name' in record && record.name) return record.name
  if ('routeMapId' in record) return record.googlePlaceId
  if ('tripId' in record && 'placeId' in record) {
    const trip = findName(review, side, 'trips', record.tripId) ?? '未知行程'
    const place = findName(review, side, 'places', record.placeId) ?? '未知地點'
    return `${trip}／${record.date}／${place}`
  }
  return '未命名資料'
}

export function ConflictRecordTitle({ review, row }: { review: SyncConflictReview; row: Row }) {
  return <>{conflictRecordTitle(review, row, row.local ? 'local' : 'cloud')}</>
}

export function ConflictRecordValue({ review, row, side, field }: {
  review: SyncConflictReview; row: Row; side: Side; field: string
}) {
  const value = (row[side] as unknown as Record<string, unknown> | null)?.[field]
  if (value === undefined || value === null) return <>未設定</>
  const entity = field === 'id' ? row.entity : references[field]
  if (entity) {
    const ids = Array.isArray(value) ? value : [value]
    if (!ids.length) return <>未設定</>
    return <>{ids.map((id) => <div key={String(id)}>
      <span>{field === 'id' ? conflictRecordTitle(review, row, side)
        : findName(review, side, entity, String(id)) ?? '找不到名稱（可能已刪除或需更新預覽）'}</span>
      <details><summary>查看 ID</summary><small>{String(id)}</small></details>
    </div>)}</>
  }
  return <>{typeof value === 'string' ? value : JSON.stringify(value)}</>
}