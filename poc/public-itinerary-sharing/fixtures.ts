import type { DemoDataset, ItineraryItem, PersonalDataset, Place, PlaceIcon, PublicItinerary } from './models'

type Stop = [name: string, icon: PlaceIcon, time: string, note: string]

// Deterministic fixture builder, not a publishing/clone implementation.
function personalFixture(id: string, name: string, regionId: string, startDate: string, days: Stop[][]): PersonalDataset {
  const places: Place[] = []
  const items: ItineraryItem[] = []
  const dateAt = (offset: number) => {
    const date = new Date(`${startDate}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() + offset)
    return date.toISOString().slice(0, 10)
  }
  days.forEach((stops, day) => stops.forEach(([placeName, icon, arrivalTime, note], order) => {
    const placeId = `${id}-place-${day}-${order}`
    places.push({
      id: placeId, name: placeName, icon,
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(placeName)}`,
      regionIds: [regionId], labelIds: ['demo-private'], notes: '私人收藏備註，不應公開',
    })
    items.push({
      id: `${id}-item-${day}-${order}`, tripId: id, placeId, date: dateAt(day),
      arrivalTime, durationMinutes: 90, transport: order ? 'WALKING' : undefined,
      travelDurationMinutes: order ? 20 : undefined, travelDistanceMeters: order ? 1200 : undefined,
      note, order,
    })
  }))
  return {
    regions: [{ id: regionId, name: regionId === 'demo-kyoto' ? '日本・京都' : '台灣・台北', zoom: 13 }],
    trips: [{ id, name, regionId, startDate, endDate: dateAt(days.length - 1) }],
    places, items, labels: [{ id: 'demo-private', name: '我的必訪清單', color: '#bd9670' }],
  }
}

export function createDemoDataset(): DemoDataset {
  const kyoto = personalFixture('demo-personal-kyoto', '京都慢旅・寺院與咖啡三日', 'demo-kyoto', '2026-11-06', [
    [['清水寺', '⛩️', '09:00', '從清水坂上山，早上避開人潮。'], ['二年坂・三年坂', '📷', '11:00', '沿石板路散步，留時間逛小店。'], ['% Arabica 東山', '☕', '14:00', '下午喝杯咖啡，再步行前往祇園。']],
    [['伏見稻荷大社', '⛩️', '08:30', '沿千本鳥居散步。'], ['錦市場', '🍜', '12:00', '在市場吃午餐，品嚐京都小吃。'], ['鴨川', '🌳', '16:00', '傍晚沿河散步。']],
    [['嵐山竹林', '🌳', '09:00', '早晨漫步竹林。'], ['天龍寺', '⛩️', '11:00', '參觀庭園。'], ['渡月橋', '📷', '14:00', '橋邊欣賞山景，結束三日旅程。']],
  ])
  const taipei = personalFixture('demo-source-taipei', '台北週末・老街與城市散步', 'demo-taipei', '2026-11-14', [
    [['大稻埕', '🏛️', '09:30', '從迪化街開始，逛老屋與選物店。'], ['永樂市場', '🍜', '12:00', '市場周邊享用台式午餐。'], ['大稻埕碼頭', '🌳', '16:00', '沿河散步，欣賞夕陽。']],
    [['中正紀念堂', '🏛️', '09:00', '廣場散步與建築參觀。'], ['永康街', '🍜', '12:00', '午餐後找一間咖啡店休息。'], ['華山文創園區', '🎨', '15:00', '看展覽，逛週末市集。']],
  ])
  const publicFixture = (data: PersonalDataset, id: string, createdAt: string): PublicItinerary => ({
    id, sourceTripId: data.trips[0].id, createdAt, updatedAt: null,
    snapshot: {
      schemaVersion: 1,
      region: { ...data.regions[0], id: `${id}-region` },
      trip: { ...data.trips[0], id: `${id}-trip`, regionId: `${id}-region` },
      places: data.places.map((place, index) => ({
        id: `${id}-place-${index}`, name: place.name, icon: place.icon,
        mapsUrl: place.mapsUrl, regionIds: [`${id}-region`],
      })),
      items: data.items.map((item, index) => ({
        ...item, id: `${id}-item-${index}`, tripId: `${id}-trip`, placeId: `${id}-place-${index}`,
      })),
    },
  })
  return structuredClone({
    ...kyoto,
    publicItineraries: [
      publicFixture(kyoto, 'demo-public-kyoto', '2026-10-19T00:00:00.000Z'),
      publicFixture(taipei, 'demo-public-taipei', '2026-10-18T00:00:00.000Z'),
    ],
  })
}
