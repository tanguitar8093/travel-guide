import { expect, it } from 'vitest'
import { EntityInUseError, EntityNotFoundError, ValidationError } from './errors'
import { validateCoordinatePair, validateStoredLocation } from './location.validation'
import { validatePlace, validateRegion, validateRouteMap, validateTrip } from './validation'
import { validateRouteEndpoint } from './route-endpoint'
import { BackupRepository } from './backup.repository'

it.each([
  ['Region', '區域'],
  ['Place', '地點'],
  ['Label', '標籤'],
  ['Parent label', '上層標籤'],
  ['Trip', '行程'],
  ['Shared trip', '共同行程'],
  ['Shared place', '共同行程地點'],
  ['Itinerary item', '行程項目'],
  ['Route map', '試算地圖'],
  ['Route map place', '試算地圖地點'],
  ['Record', '資料'],
])('localizes %s errors while retaining error types and record IDs', (entity, name) => {
  const missing = new EntityNotFoundError(entity, 'record-id')
  expect(missing.message).toBe(`找不到${name}「record-id」。`)
  expect(missing.name).toBe('EntityNotFoundError')
  const inUse = new EntityInUseError(entity, 'record-id', '仍有資料使用中。')
  expect(inUse.message).toBe(`無法刪除${name}「record-id」：仍有資料使用中。`)
  expect(inUse.name).toBe('EntityInUseError')
})

it.each([
  [() => validateCoordinatePair(91, 127), '緯度必須介於 -90 與 90。'],
  [() => validateCoordinatePair(26, 181), '經度必須介於 -180 與 180。'],
  [() => validateStoredLocation(null), '已儲存的位置必須是物件。'],
  [() => validatePlace({ name: '', regionIds: [], labelIds: [] }), '地點名稱不可空白。'],
  [() => validateRegion({ name: '區域', zoom: 10 }), '請為區域選取 Google Maps 地點。'],
  [() => validateTrip({ name: '行程', regionId: 'region', startDate: 'invalid', endDate: '2026-10-23' }),
    '行程開始日期必須是有效日期，格式為 YYYY-MM-DD。'],
  [() => validateRouteMap({ name: '地圖', transport: 'invalid' }), '試算地圖的交通方式無效。'],
  [() => validateRouteEndpoint({ kind: 'invalid' }), '路線端點類型無效。'],
  [() => new BackupRepository().validateImport(null), '備份必須是物件。'],
])('provides a Chinese validation message without changing the validation error class (%#)', (validate, message) => {
  expect(validate).toThrow(ValidationError)
  expect(validate).toThrow(message)
})
