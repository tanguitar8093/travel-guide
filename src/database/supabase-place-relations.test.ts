import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const requests = vi.hoisted(() => ({ urls: [] as string[] }))
vi.mock('./supabase.client', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabase: createClient('https://example.supabase.co', 'test-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input: RequestInfo | URL) => {
          const url = new URL(String(input))
          requests.urls.push(url.toString())
          const table = url.pathname.split('/').at(-1)
          const data = table === 'places'
            ? [{ id: 'place-1', name: 'Place', icon: null, maps_url: 'https://example.com', google_place_id: null, notes: null, place_regions: [{ region_id: 'region-1' }], place_labels: [{ label_id: 'label-1' }] }]
            : [{ place_id: 'place-1' }]
          return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
        },
      },
    }),
  }
})

import { SupabasePlaceRepository } from './supabase.repositories'

beforeEach(() => {
  requests.urls = []
  vi.stubGlobal('window', { setTimeout, clearTimeout })
})

afterEach(() => { vi.unstubAllGlobals() })

// Use the actual SDK to verify the outgoing REST query and normalized relations.
describe('place embeds with multiple database foreign keys', () => {
  it.each(['list', 'findByRegionId', 'findByLabelIds'] as const)('%s explicitly selects the original relationship', async (method) => {
    const repository = new SupabasePlaceRepository()
    const places = method === 'list' ? await repository.list()
      : method === 'findByRegionId' ? await repository.findByRegionId('region-1')
      : await repository.findByLabelIds(['label-1'])
    expect(places[0].regionIds).toEqual(['region-1'])
    expect(places[0].labelIds).toEqual(['label-1'])
    const placeQuery = requests.urls.map((url) => new URL(url)).find((url) => url.pathname.endsWith('/places'))
    const select = placeQuery?.searchParams.get('select')
    expect(select).toContain('place_regions!place_regions_place_id_fkey(region_id)')
    expect(select).toContain('place_labels!place_labels_place_id_fkey(label_id)')
  })
})
