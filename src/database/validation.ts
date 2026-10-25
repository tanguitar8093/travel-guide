import { ValidationError } from './errors'
import { placeIcons } from './models'
import { validateCoordinatePair, validateLocationMetadata, validateStoredLocation } from './location.validation'
import { getRouteMapEndpoint, routeEndpointKey } from './route-endpoint'
import { isInsideOsmCoverage, isOsmDatasetId, regionOsmDataset, osmDatasets } from '../geo/osm-datasets'
import type {
  ItineraryItem,
  Label,
  Place,
  Region,
  Trip,
  NewRouteMap,
  NewRouteMapPlace,
} from './models'

export function validateRouteMap(map: NewRouteMap): void {
  requireText(map.name, '試算地圖名稱')
  if (map.tripId !== undefined) requireText(map.tripId, '行程識別碼')
  if (map.selectedDate !== undefined) requireDate(map.selectedDate, '選取日期')
  if (map.originGooglePlaceId !== undefined) requireText(map.originGooglePlaceId, '起點 Google 地點識別碼')
  if (map.destinationGooglePlaceId !== undefined) requireText(map.destinationGooglePlaceId, '終點 Google 地點識別碼')
  if (map.originGooglePlaceId && map.originGooglePlaceId === map.destinationGooglePlaceId) {
    throw new ValidationError('起點與終點不可相同。')
  }
  const origin = getRouteMapEndpoint({ ...map, id: 'validation' }, 'origin')
  const destination = getRouteMapEndpoint({ ...map, id: 'validation' }, 'destination')
  if (origin && destination && routeEndpointKey(origin) === routeEndpointKey(destination)) {
    throw new ValidationError('起點與終點不可相同。')
  }
  if (!['DRIVING', 'TRANSIT', 'WALKING', 'BICYCLING', 'TWO_WHEELER'].includes(map.transport)) {
    throw new ValidationError('試算地圖的交通方式無效。')
  }
}

export function validateRouteMapPlace(place: NewRouteMapPlace): void {
  requireText(place.routeMapId, '試算地圖識別碼')
  if (place.googlePlaceId !== undefined) requireText(place.googlePlaceId, 'Google 地點識別碼')
  if (place.location !== undefined) {
    validateStoredLocation(place.location)
    requireText(place.name, '試算地圖地點名稱')
  }
  if (place.googlePlaceId === undefined && place.location === undefined) {
    throw new ValidationError('試算地圖地點需要 Google 地點識別碼或已儲存的座標。')
  }
  if (place.name !== undefined) requireText(place.name, '試算地圖地點名稱')
}

function requireText(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`${field}不可空白。`)
  }
}

function requireDate(value: string, field: string): void {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(timestamp) ||
      new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new ValidationError(`${field}必須是有效日期，格式為 YYYY-MM-DD。`)
  }
}

function requireIds(ids: string[], field: string): void {
  if (!Array.isArray(ids)) {
    throw new ValidationError(`${field}必須是識別碼清單。`)
  }
  for (const id of ids) {
    requireText(id, `${field}中的識別碼`)
  }
}

export function validateRegion(
  region: Omit<Region, 'id' | 'center' | 'centerMetadata'> & { center?: unknown; centerMetadata?: unknown },
): void {
  requireText(region.name, '地圖名稱')
  if (region.mapProvider !== undefined && !['google', 'osm'].includes(region.mapProvider)) {
    throw new ValidationError('地圖的供應商無效。')
  }
  if (region.osmDataset !== undefined && (region.mapProvider !== 'osm' || !isOsmDatasetId(region.osmDataset))) {
    throw new ValidationError('地圖的 OSM 圖資設定無效。')
  }
  if (region.googlePlaceId !== undefined) {
    requireText(region.googlePlaceId, 'Google 地點識別碼')
  }
  if (region.center !== undefined) {
    if (typeof region.center !== 'object' || region.center === null || Array.isArray(region.center) ||
        !('latitude' in region.center) || !('longitude' in region.center)) {
      throw new ValidationError('地圖中心必須包含緯度與經度。')
    }
    validateCoordinatePair(region.center.latitude, region.center.longitude)
  } else if (region.googlePlaceId === undefined) {
    throw new ValidationError('請為地圖選取 Google Maps 地點。')
  }

  if (region.centerMetadata !== undefined) {
    validateLocationMetadata(region.centerMetadata)
    if (region.center === undefined) {
      throw new ValidationError('設定地圖中心的來源資料時，必須同時提供中心座標。')
    }
  }

  if (region.mapProvider === 'osm') {
    if (region.googlePlaceId !== undefined || !region.center || !region.centerMetadata) {
      throw new ValidationError('OSM 地圖需要已確認來源的中心座標，且不可使用 Google 地點識別碼。')
    }
    if (!isInsideOsmCoverage(region.center, regionOsmDataset(region))) {
      throw new ValidationError(`OSM 地圖中心超出目前${osmDatasets[regionOsmDataset(region)].name}圖資範圍。`)
    }
  }

  if (!Number.isFinite(region.zoom) || region.zoom < 0 || region.zoom > 22) {
    throw new ValidationError('地圖的縮放層級必須介於 0 與 22。')
  }
}

export function validatePlaceRegionProviders(
  place: Pick<Place, 'googlePlaceId' | 'location' | 'regionIds'>,
  regions: readonly Region[],
): void {
  const linkedRegions = regions.filter(region => place.regionIds.includes(region.id))
  if (place.location) {
    if (place.googlePlaceId !== undefined) {
      throw new ValidationError('同一地點不可同時使用 Google 與 OSM 位置。')
    }
    if (!place.regionIds.length || linkedRegions.length !== new Set(place.regionIds).size || linkedRegions.some(region => region.mapProvider !== 'osm')) {
      throw new ValidationError('OSM 地點只能歸屬於 OSM 地圖。')
    }
    for (const region of linkedRegions) {
      const dataset = regionOsmDataset(region)
      if (!isInsideOsmCoverage(place.location.coordinate, dataset)) {
        throw new ValidationError(`OSM 地點僅限於所屬地圖的${osmDatasets[dataset].name}圖資範圍內。`)
      }
    }
  } else if (place.googlePlaceId && linkedRegions.some(region => region.mapProvider === 'osm')) {
    throw new ValidationError('Google 地點只能歸屬於 Google 地圖。')
  } else if (linkedRegions.some(region => region.mapProvider === 'osm')) {
    throw new ValidationError('請先搜尋並選取地點，或輸入有效的緯度、經度；只有導航網址不能建立 OSM 地點。')
  }
}

export function validatePlace(place: Omit<Place, 'id'>): void {
  requireText(place.name, '地點名稱')
  if (place.location !== undefined) validateStoredLocation(place.location)
  if (
    place.icon !== undefined &&
    !placeIcons.some((icon) => icon === place.icon)
  ) {
    throw new ValidationError('不支援此地點圖示。')
  }
  if (place.googlePlaceId !== undefined) {
    requireText(place.googlePlaceId, 'Google 地點識別碼')
  }
  requireIds(place.regionIds, '所屬地圖')
  requireIds(place.labelIds, '地點標籤')

  if (place.notes !== undefined && typeof place.notes !== 'string') {
    throw new ValidationError('地點備註必須是文字。')
  }

  if (place.mapsUrl !== undefined) {
    requireText(place.mapsUrl, '導航網址')
    let url: URL
    try {
      url = new URL(place.mapsUrl)
    } catch {
      throw new ValidationError('導航網址必須是有效的完整網址。')
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new ValidationError('導航網址必須使用 HTTP 或 HTTPS。')
    }
  }

  if (place.googlePlaceId === undefined && place.mapsUrl === undefined && place.location === undefined) {
    throw new ValidationError('請選取 Google Maps 地點、填寫導航網址，或提供已儲存的座標。')
  }
}

export function validateLabel(label: Omit<Label, 'id'>): void {
  requireText(label.name, '標籤名稱')
  requireText(label.color, '標籤顏色')
  if (label.parentId !== undefined) {
    requireText(label.parentId, '上層標籤識別碼')
  }
}

export function validateTrip(trip: Omit<Trip, 'id'>): void {
  requireText(trip.name, '行程名稱')
  requireText(trip.regionId, '行程地圖識別碼')
  requireDate(trip.startDate, '行程開始日期')
  requireDate(trip.endDate, '行程結束日期')

  if (trip.endDate < trip.startDate) {
    throw new ValidationError('行程結束日期不可早於開始日期。')
  }
}

export function validateItineraryItem(item: Omit<ItineraryItem, 'id'>): void {
  requireText(item.tripId, '行程識別碼')
  requireText(item.placeId, '地點識別碼')
  requireDate(item.date, '行程項目日期')

  if (!Number.isInteger(item.order) || item.order < 0) {
    throw new ValidationError('行程項目順序必須是大於或等於 0 的整數。')
  }

  if (item.arrivalTime !== undefined &&
      (typeof item.arrivalTime !== 'string' ||
       !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.arrivalTime))) {
    throw new ValidationError('抵達時間必須使用 HH:mm 格式。')
  }

  if (item.durationMinutes !== undefined &&
      (!Number.isInteger(item.durationMinutes) || item.durationMinutes <= 0)) {
    throw new ValidationError('停留時間必須是大於 0 的分鐘數。')
  }

  if (item.travelDurationMinutes !== undefined &&
      (!Number.isInteger(item.travelDurationMinutes) || item.travelDurationMinutes < 0)) {
    throw new ValidationError('路程時間必須是大於或等於 0 的分鐘數。')
  }

  if (item.transport !== undefined && typeof item.transport !== 'string') {
    throw new ValidationError('交通方式必須是文字。')
  }
  if (item.travelDistanceMeters !== undefined &&
      (!Number.isSafeInteger(item.travelDistanceMeters) || item.travelDistanceMeters < 0)) {
    throw new ValidationError('路程距離必須是大於或等於 0 的整數公尺數。')
  }
  if (item.note !== undefined && typeof item.note !== 'string') {
    throw new ValidationError('行程項目備註必須是文字。')
  }
}
