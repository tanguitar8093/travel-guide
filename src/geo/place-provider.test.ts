import { afterEach, expect, it, vi } from 'vitest'
import type { Place } from '../database/models'
import { placesForMapProvider } from './place-provider'

it('hides Google Place IDs in OSM while preserving shared labels and source records', () => {
  const records = [
    { id: 'google', googlePlaceId: 'google-id', labelIds: ['shared'] },
    { id: 'both', googlePlaceId: 'google-id-2', location: { source: 'osm' }, labelIds: ['shared'] },
    { id: 'osm', location: { source: 'osm', coordinate: { latitude: 26.4, longitude: 127.9 } }, labelIds: ['shared'] },
    { id: 'custom', labelIds: ['shared'] },
  ] as Place[]
  expect(placesForMapProvider(records, 'osm').map(place => place.id)).toEqual(['osm', 'custom'])
  expect(placesForMapProvider(records, 'google')).toEqual(records)
  expect(placesForMapProvider(records, undefined)).toEqual([])
  expect(records).toHaveLength(4)
  expect(records.every(place => place.labelIds.includes('shared'))).toBe(true)
})

it('separates overlapping Okinawa and Japan ownership at the same coordinate',async()=>{
  const {osmRegion}=await import('./osm-datasets')
  const regions=[{...osmRegion('okinawa'),id:'ok'},{...osmRegion('japan'),id:'jp'}]
  const records=regions.map(region=>({id:region.id,regionIds:[region.id],name:region.name,labelIds:[],location:{source:'user',kind:'user-picked',coordinate:{latitude:26.2124,longitude:127.6809}}})) as Place[]
  expect(placesForMapProvider(records,'osm',regions,'japan').map(row=>row.id)).toEqual(['jp'])
  expect(placesForMapProvider(records,'osm',regions,'okinawa').map(row=>row.id)).toEqual(['ok'])
})


afterEach(()=>vi.unstubAllGlobals())
it('keeps Google and unset-provider paths independent of invalid OSM settings',()=>{
  vi.stubGlobal('window',{localStorage:{getItem:()=> 'invalid-dataset'}})
  const records=[{id:'google',name:'Google',googlePlaceId:'google-id',regionIds:[],labelIds:[]}] as Place[]
  expect(placesForMapProvider(records,'google')).toEqual(records)
  expect(placesForMapProvider(records,undefined)).toEqual([])
  expect(()=>placesForMapProvider(records,'osm')).toThrow('OSM 區域設定無效')
})
