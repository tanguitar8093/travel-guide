import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const insertCalls = vi.hoisted(() => [] as Array<{ table: string; payload: unknown }>)
const generatedIds = vi.hoisted(() => [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
  '00000000-0000-4000-8000-000000000005',
])
const authUserId = '11111111-1111-4111-8111-111111111111'

class MockQueryBuilder {
  private readonly table: string
  private payload: unknown = undefined
  private filters = new Map<string, unknown>()

  constructor(table: string) {
    this.table = table
  }

  select(): this {
    return this
  }

  insert(payload: unknown): this {
    this.payload = payload
    insertCalls.push({ table: this.table, payload })
    return this
  }

  delete(): this {
    return this
  }

  update(payload: unknown): this {
    this.payload = payload
    return this
  }

  eq(column: string, value: unknown): this {
    this.filters.set(column, value)
    return this
  }

  in(column: string, value: unknown): this {
    this.filters.set(column, value)
    return this
  }

  order(): this {
    return this
  }

  maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: null }> {
    if (this.table === 'regions') {
      return Promise.resolve({ data: { id: this.filters.get('id') ?? 'region-1' }, error: null })
    }
    if (this.table === 'labels') {
      return Promise.resolve({ data: { id: this.filters.get('id') ?? 'label-1' }, error: null })
    }
    if (this.table === 'trips') {
      return Promise.resolve({
        data: {
          id: this.filters.get('id') ?? 'trip-1',
          region_id: 'region-1',
          name: 'Trip',
          start_date: '2026-10-16',
          end_date: '2026-10-17',
        },
        error: null,
      })
    }
    if (this.table === 'places') {
      return Promise.resolve({
        data: {
          id: this.filters.get('id') ?? 'place-1',
          name: 'Place',
          icon: null,
          maps_url: 'https://example.com',
          google_place_id: null,
          notes: null,
          place_regions: [{ region_id: 'region-1' }],
          place_labels: [],
        },
        error: null,
      })
    }

    return Promise.resolve({ data: null, error: null })
  }

  single(): Promise<{ data: { id: string }; error: null }> {
    const row = Array.isArray(this.payload) ? this.payload[0] : this.payload
    const id = (row as { id?: string } | null | undefined)?.id
    return Promise.resolve({ data: { id: id ?? 'missing-id' }, error: null })
  }

  then<TResult1 = { data: null; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({ data: null, error: null }).then(onfulfilled, onrejected)
  }
}

vi.mock('./supabase.client', () => ({
  supabase: {
    from: (table: string) => new MockQueryBuilder(table),
    auth: {
      getUser: async () => ({ data: { user: { id: authUserId } }, error: null }),
    },
  },
}))

import {
  SupabaseItineraryItemRepository,
  SupabaseLabelRepository,
  SupabasePlaceRepository,
  SupabaseTripRepository,
} from './supabase.repositories'
import { SupabaseRegionRepository } from './supabase.region.repository'

beforeEach(() => {
  insertCalls.length = 0
  let index = 0
  vi.stubGlobal('crypto', {
    randomUUID: () => {
      const id = generatedIds[index]
      index += 1
      if (!id) {
        throw new Error('No test UUID available.')
      }
      return id
    },
  })
  vi.stubGlobal('window', { setTimeout, clearTimeout })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('supabase create operations provide explicit id payloads', () => {
  it('sends id for region/label/place/trip/itinerary creation', async () => {
    const regionRepository = new SupabaseRegionRepository()
    const labelRepository = new SupabaseLabelRepository()
    const placeRepository = new SupabasePlaceRepository()
    const tripRepository = new SupabaseTripRepository()
    const itineraryRepository = new SupabaseItineraryItemRepository()

    const regionId = await regionRepository.create({
      name: 'Region',
      googlePlaceId: 'google-region',
      zoom: 10,
    })
    const labelId = await labelRepository.create({
      name: 'Label',
      color: '#00aaff',
    })
    const placeId = await placeRepository.create({
      name: 'Place',
      mapsUrl: 'https://example.com/maps',
      regionIds: ['region-1'],
      labelIds: [],
    })
    const tripId = await tripRepository.create({
      name: 'Trip',
      regionId: 'region-1',
      startDate: '2026-10-16',
      endDate: '2026-10-17',
    })
    const itineraryItemId = await itineraryRepository.create({
      tripId: 'trip-1',
      placeId: 'place-1',
      date: '2026-10-16',
      order: 0,
    })

    expect(regionId).toBe(generatedIds[0])
    expect(labelId).toBe(generatedIds[1])
    expect(placeId).toBe(generatedIds[2])
    expect(tripId).toBe(generatedIds[3])
    expect(itineraryItemId).toBe(generatedIds[4])

    const insertedByTable = new Map(
      insertCalls
        .filter((call) => ['regions', 'labels', 'places', 'trips', 'itinerary_items'].includes(call.table))
        .map((call) => [call.table, call.payload as { id?: string }]),
    )

    expect(insertedByTable.get('regions')?.id).toBe(generatedIds[0])
    expect(insertedByTable.get('labels')?.id).toBe(generatedIds[1])
    expect(insertedByTable.get('places')?.id).toBe(generatedIds[2])
    expect(insertedByTable.get('trips')?.id).toBe(generatedIds[3])
    expect(insertedByTable.get('itinerary_items')?.id).toBe(generatedIds[4])
  })
})
