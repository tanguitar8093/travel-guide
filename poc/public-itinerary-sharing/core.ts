import type { PublicItineraryDatabase } from './database'
import {
  SharingError, type ItineraryItem, type PublicItinerary, type PublicItineraryCore,
  type PublicPlace, type PublicSnapshot, type Region, type Trip,
} from './models'

// Whitelist public fields so private data never crosses the snapshot boundary.
function publicPlace(place: PublicPlace, id: string, regionId: string): PublicPlace {
  return {
    id, name: place.name, regionIds: [regionId],
    ...(place.icon !== undefined && { icon: place.icon }),
    ...(place.mapsUrl !== undefined && { mapsUrl: place.mapsUrl }),
    ...(place.googlePlaceId !== undefined && { googlePlaceId: place.googlePlaceId }),
  }
}

function cloneGraph(region: Region, trip: Trip, places: PublicPlace[], items: ItineraryItem[]): PublicSnapshot {
  const regionId = crypto.randomUUID()
  const tripId = crypto.randomUUID()
  const placeIds = new Map(places.map(place => [place.id, crypto.randomUUID()]))
  return structuredClone({
    schemaVersion: 1,
    region: { ...region, id: regionId },
    trip: { ...trip, id: tripId, regionId },
    places: places.map(place => publicPlace(place, placeIds.get(place.id)!, regionId)),
    items: items.map(item => ({
      ...item, id: crypto.randomUUID(), tripId, placeId: placeIds.get(item.placeId)!,
    })),
  })
}

export function createPublicItineraryCore(db: PublicItineraryDatabase): PublicItineraryCore {
  const sourceTables = [db.trips, db.regions, db.places, db.itineraryItems, db.publicItineraries]

  async function requirePublic(publicId: string, sourceTripId?: string): Promise<PublicItinerary> {
    const row = await db.publicItineraries.get(publicId)
    if (!row) throw new SharingError('PUBLIC_NOT_FOUND')
    if (sourceTripId !== undefined && row.sourceTripId !== sourceTripId) {
      throw new SharingError('SOURCE_MISMATCH')
    }
    return row
  }

  async function snapshotSource(sourceTripId: string): Promise<PublicSnapshot> {
    const trip = await db.trips.get(sourceTripId)
    if (!trip) throw new SharingError('SOURCE_NOT_FOUND')
    const region = await db.regions.get(trip.regionId)
    if (!region || !trip.id || !trip.regionId) throw new SharingError('INVALID_SOURCE')
    const items = await db.itineraryItems.where('tripId').equals(sourceTripId).toArray()
    const places = await db.places.bulkGet([...new Set(items.map(item => item.placeId))])
    if (places.some(place => !place)) throw new SharingError('INVALID_SOURCE')
    return cloneGraph(region, trip, places.map(place => place!), items)
  }

  return {
    async list(query = {}) {
      const search = query.search?.trim().toLocaleLowerCase() ?? ''
      const rows = await db.publicItineraries.toArray()
      return rows.filter(({ snapshot }) =>
        (!search || snapshot.trip.name.toLocaleLowerCase().includes(search)
          || snapshot.region.name.toLocaleLowerCase().includes(search))
        && (!query.regionName || snapshot.region.name === query.regionName),
      ).sort((a, b) => a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1
        : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    },
    async readSnapshot(publicId) {
      return structuredClone((await requirePublic(publicId)).snapshot)
    },
    async findBySource(sourceTripId) {
      return db.publicItineraries.where('sourceTripId').equals(sourceTripId).first()
    },
    async publish(sourceTripId) {
      if (!sourceTripId) throw new SharingError('SOURCE_NOT_FOUND')
      return db.transaction('rw', sourceTables, async () => {
        if (await db.publicItineraries.where('sourceTripId').equals(sourceTripId).first()) {
          throw new SharingError('ALREADY_PUBLISHED')
        }
        const snapshot = await snapshotSource(sourceTripId)
        const row: PublicItinerary = {
          id: crypto.randomUUID(), sourceTripId,
          createdAt: new Date().toISOString(), updatedAt: null, snapshot,
        }
        await db.publicItineraries.add(row)
        return structuredClone(row)
      })
    },
    async update(publicId, sourceTripId) {
      return db.transaction('rw', sourceTables, async () => {
        const existing = await requirePublic(publicId, sourceTripId)
        const snapshot = await snapshotSource(sourceTripId)
        const row = { ...existing, snapshot, updatedAt: new Date().toISOString() }
        await db.publicItineraries.put(row)
        return structuredClone(row)
      })
    },
    async withdraw(publicId, sourceTripId) {
      return db.transaction('rw', db.publicItineraries, async () => {
        await requirePublic(publicId, sourceTripId)
        await db.publicItineraries.delete(publicId)
      })
    },
    async apply(publicId) {
      return db.transaction('rw', [...sourceTables, db.labels], async () => {
        const { snapshot } = await requirePublic(publicId)
        const copy = cloneGraph(snapshot.region, snapshot.trip, snapshot.places, snapshot.items)
        copy.region.name = `${snapshot.region.name}(分享)`
        // Each application owns its label, even when another copy has the same name.
        const colors = ['#e9905a', '#d97768', '#c4809b', '#8b80b5', '#758dab', '#6c9a79', '#b77a53', '#5f9b9b']
        const label = {
          id: crypto.randomUUID(), name: `${snapshot.trip.name}(分享)`,
          color: colors[Math.floor(Math.random() * colors.length)],
        }
        const names = new Set((await db.trips.toArray()).map(trip => trip.name))
        let suffix = 1
        const copyName = () => `${snapshot.trip.name}（副本${suffix === 1 ? '' : ` ${suffix}`}）`
        while (names.has(copyName())) suffix++
        copy.trip.name = copyName()
        await db.regions.add(copy.region)
        await db.labels.add(label)
        await db.places.bulkAdd(copy.places.map(place => ({ ...place, labelIds: [label.id] })))
        await db.trips.add(copy.trip)
        await db.itineraryItems.bulkAdd(copy.items)
        return structuredClone(copy.trip)
      })
    },
  }
}
