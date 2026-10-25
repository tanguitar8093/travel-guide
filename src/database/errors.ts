const entityNames: Readonly<Record<string, string>> = {
  Region: '地圖',
  Place: '地點',
  Label: '標籤',
  'Parent label': '上層標籤',
  Trip: '行程',
  'Shared trip': '共同行程',
  'Shared place': '共同行程地點',
  'Itinerary item': '行程項目',
  'Route map': '試算地圖',
  'Route map place': '試算地圖地點',
  Record: '資料',
}

export class EntityNotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`找不到${entityNames[entity] ?? entity}「${id}」。`)
    this.name = 'EntityNotFoundError'
  }
}

export class EntityInUseError extends Error {
  constructor(entity: string, id: string, reason: string) {
    super(`無法刪除${entityNames[entity] ?? entity}「${id}」：${reason}`)
    this.name = 'EntityInUseError'
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}
