import { expect, it } from 'vitest'
import type { Place } from '../database/models'
import { placesForMapProvider } from './place-provider'

it('hides Google Place IDs in OSM while preserving shared labels and source records', () => {
  const records = [
    { id: 'google', googlePlaceId: 'google-id', labelIds: ['shared'] },
    { id: 'both', googlePlaceId: 'google-id-2', location: { source: 'osm' }, labelIds: ['shared'] },
    { id: 'osm', location: { source: 'osm' }, labelIds: ['shared'] },
    { id: 'custom', labelIds: ['shared'] },
  ] as Place[]
  expect(placesForMapProvider(records, 'osm').map(place => place.id)).toEqual(['osm', 'custom'])
  expect(placesForMapProvider(records, 'google')).toEqual(records)
  expect(placesForMapProvider(records, undefined)).toEqual([])
  expect(records).toHaveLength(4)
  expect(records.every(place => place.labelIds.includes('shared'))).toBe(true)
})
