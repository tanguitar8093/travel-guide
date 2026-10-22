import type { ItineraryItem, NewPlace, PlaceChanges, NewTrip, TripChanges, NewItineraryItem, ItineraryItemChanges } from '../../src/database/models'
import { savedPlaces, candidates, trip, RouteCalculatorController } from './controller'

const regions = [{ id: trip.regionId, name: '沖繩', center: { latitude: 26.43, longitude: 127.9 }, zoom: 9 }]
const labels = [{ id: 'preview-scenery', name: '景點', color: '#648a74' }, { id: 'preview-food', name: '美食', color: '#c3a369' }]
const trips = [trip]
const items: ItineraryItem[] = savedPlaces.map((p, index) => ({ id: 'preview-item-'+index, tripId: trip.id, placeId: p.id, date: index === 3 ? '2026-11-08' : '2026-11-07', arrivalTime: ['10:00','11:00','13:30','11:00'][index], durationMinutes: 90, transport: 'DRIVING', order: index === 3 ? 0 : index }))
const geo = new RouteCalculatorController()
const clone = <T,>(value: T): T => structuredClone(value)
function findPlace(id: string) { const place = savedPlaces.find(p => p.id === id); if (!place) throw new Error('地點不存在。'); return place }

export const placeController = {
  async loadWorkspace() { return clone({ places: savedPlaces, regions, labels }) },
  async getById(id: string) { return clone(findPlace(id)) },
  async search(query: { search?: string; labelIds?: string[]; regionId?: string } = {}) {
    return clone(savedPlaces.filter(p => (!query.search || p.name.toLowerCase().includes(query.search.trim().toLowerCase())) && (!query.regionId || p.regionIds.includes(query.regionId)) && (!query.labelIds?.length || query.labelIds.some(id => p.labelIds.includes(id)))))
  },
  async create(input: NewPlace) { const id = crypto.randomUUID(); savedPlaces.push({ ...clone(input), mapsUrl: input.googlePlaceId ? candidates.get(input.googlePlaceId)?.googleMapsUri : input.mapsUrl, id }); return id },
  async update(id: string, changes: PlaceChanges) { Object.assign(findPlace(id), clone(changes), changes.googlePlaceId ? { mapsUrl: candidates.get(changes.googlePlaceId)?.googleMapsUri } : {}) },
  async delete(id: string) { if (items.some(item => item.placeId === id)) throw new Error('地點仍被行程引用，請先移除行程項目。'); const index = savedPlaces.findIndex(p => p.id === id); if(index >= 0) savedPlaces.splice(index,1) },
  async deleteMany(ids: string[]) { const result = { deletedIds: [] as string[], failures: [] as { id: string; name: string; message: string }[] }; for(const id of ids) { try { await this.delete(id); result.deletedIds.push(id) } catch(cause) { result.failures.push({ id, name: findPlace(id).name, message: String(cause) }) } } return result },
  async assignLabelMany(ids: string[], labelId: string) { for(const id of ids) { const p=findPlace(id); if(!p.labelIds.includes(labelId))p.labelIds.push(labelId) } return { succeededIds: ids, failures: [] } },
  isGooglePlacesConfigured: () => true,
  mountPlaceAutocomplete: geo.mountAutocomplete.bind(geo),
  async getGooglePlaceDetails(id: string) { const detail = candidates.get(id); if (!detail) throw new Error('此預覽地點尚未定位。'); return clone(detail) },
}
export const labelController = { async listTree() { return clone(labels.map(label => ({ ...label, children: [] }))) } }
export class ItineraryController {
  getAccess() { return 'owner' as const }
  beginEdit() {}
  async loadWorkspace() { return clone({ trips, regions, places: savedPlaces }) }
  async listItems(tripId: string) { return clone(items.filter(item => item.tripId === tripId)) }
  async createTrip(input: NewTrip) { const id=crypto.randomUUID(); trips.push({ ...clone(input), id }); return id }
  async updateTrip(id: string, changes: TripChanges) { const row=trips.find(t => t.id===id); if(row)Object.assign(row,clone(changes)) }
  async deleteTrip(id: string) { const index=trips.findIndex(t=>t.id===id); if(index>=0)trips.splice(index,1); for(let i=items.length-1;i>=0;i--)if(items[i].tripId===id)items.splice(i,1) }
  async getTripRouteMapSummary() { return { hasRouteMap: false, addedPlaceCount: 0 } }
  async loadMapData(regionId: string) {
    const markers = savedPlaces.filter(p=>p.regionIds.includes(regionId)).flatMap(p=>{ const position = p.googlePlaceId ? candidates.get(p.googlePlaceId)?.location : undefined; return position ? [{ id: p.id, title: p.name, position }] : [] })
    return { regionId, center: { lat: 26.43, lng: 127.9 }, zoom: 9, viewport: { north: 26.9, south: 25.98, east: 128.36, west: 127.58 }, markers, unlocatedPlaces: savedPlaces.filter(p=>p.regionIds.includes(regionId)&&!markers.some(m=>m.id===p.id)).map(p=>({id:p.id,name:p.name,reason:'尚未選擇可定位的 OSM 地點。'})) }
  }
  async addItem(input: Omit<NewItineraryItem,'order'>) { const id=crypto.randomUUID(); const order=items.filter(i=>i.tripId===input.tripId&&i.date===input.date).length; items.push({ ...clone(input), id, order }); return id }
  async updateItem(id: string, changes: ItineraryItemChanges) { const row=items.find(i=>i.id===id); if(row) { Object.assign(row,clone(changes)); row.travelDurationMinutes=undefined; row.travelDistanceMeters=undefined } }
  async deleteItem(id: string) { const index=items.findIndex(i=>i.id===id); if(index>=0)items.splice(index,1) }
  async reorderItems(_trip: string, _date: string, ids: string[]) { ids.forEach((id,order)=>{const row=items.find(i=>i.id===id);if(row)row.order=order}) }
  async calculateTravelDuration(id: string) { const row=items.find(i=>i.id===id); if(!row)throw new Error('行程項目不存在。'); const day=items.filter(i=>i.tripId===row.tripId&&i.date===row.date).sort((a,b)=>a.order-b.order); const previous=day[day.indexOf(row)-1];if(!previous)throw new Error('第一站不需計算路程。');const result=await geo.calculate({origin:{source:'saved',placeId:previous.placeId},destination:{source:'saved',placeId:row.placeId},transport:row.transport||'DRIVING'});row.travelDurationMinutes=result.durationMinutes;row.travelDistanceMeters=result.distanceMeters;return result }
}
export const itineraryController = new ItineraryController()
