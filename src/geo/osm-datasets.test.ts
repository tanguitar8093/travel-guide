import { afterEach, describe, expect, it, vi } from 'vitest'
import { datasetForCoordinate, isInsideOsmCoverage, osmRegion } from './osm-datasets'
import { validatePlaceRegionProviders, validateRegion } from '../database/validation'
import { regionsForMapProvider } from './region-provider'
import { getOsmDataset, setOsmDataset } from './osm-dataset-preference'

const location = (latitude: number, longitude: number) => ({ source: 'user' as const, kind: 'user-picked' as const, coordinate: { latitude, longitude } })
afterEach(() => vi.unstubAllGlobals())
describe('OSM dataset coverage and ownership', () => {
  it.each([
    ['台北',25.03,121.56], ['台南',22.997,120.212], ['高雄',22.63,120.30], ['花蓮',23.98,121.6],
    ['澎湖',23.566,119.566], ['金門',24.432,118.318], ['馬祖',26.16,119.95], ['綠島',22.66,121.49], ['蘭嶼',22.05,121.55],
  ])('accepts supported Taiwan locations: %s', (_name,latitude,longitude) => {
    expect(isInsideOsmCoverage({ latitude,longitude },'taiwan')).toBe(true)
    expect(isInsideOsmCoverage({ latitude,longitude },'okinawa')).toBe(false)
  })
  it.each([[26.4,127.9],[24.48,118.08],[24,120],[25.03,120.5],[NaN,121.56]])('rejects outside/coarse-box-only coordinates: %s, %s', (latitude,longitude) => {
    expect(isInsideOsmCoverage({ latitude,longitude },'taiwan')).toBe(false)
  })
  it('uses the saved region dataset, independently of the currently selected browsing dataset', () => {
    const taiwan={...osmRegion('taiwan'),id:'tw'},okinawa={...osmRegion('okinawa'),id:'ok'}
    validateRegion(taiwan)
    validateRegion(okinawa)
    expect(datasetForCoordinate({latitude:25.03,longitude:121.56})).toBe('taiwan')
    expect(() => validatePlaceRegionProviders({location:location(25.03,121.56),regionIds:['tw']},[taiwan])).not.toThrow()
    expect(() => validatePlaceRegionProviders({location:location(25.03,121.56),regionIds:['ok']},[okinawa])).toThrow('沖繩')
    expect(() => validatePlaceRegionProviders({location:location(26.4,127.9),regionIds:['tw']},[taiwan])).toThrow('台灣')
    expect(() => validatePlaceRegionProviders({location:location(25.03,121.56),regionIds:['tw','ok']},[taiwan,okinawa])).toThrow('沖繩')
    expect(() => validatePlaceRegionProviders({location:location(25.03,121.56),regionIds:['missing']},[])).toThrow()
    expect(regionsForMapProvider([taiwan,okinawa],'osm','taiwan')).toEqual([taiwan])
    expect(regionsForMapProvider([taiwan,okinawa],'osm',null)).toEqual([taiwan,okinawa])
  })
  it('preserves legacy preference defaults and emits region changes', () => {
    const storage=new Map<string,string>()
    const dispatchEvent=vi.fn()
    vi.stubGlobal('window',{localStorage:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)},dispatchEvent})
    expect(getOsmDataset()).toBe('okinawa')
    setOsmDataset('taiwan')
    expect(getOsmDataset()).toBe('taiwan')
    expect(dispatchEvent).toHaveBeenCalledOnce()
  })
})

it.each([
  ['東京',35.6812,139.7671],['大阪',34.7025,135.4959],['札幌',43.0687,141.3508],
  ['福岡',33.5902,130.4017],['松山',33.8392,132.7657],['那霸',26.2124,127.6809],
  ['石垣',24.3448,124.1572],['宮古',24.8055,125.2811],['父島',27.094,142.194],
])('accepts Japan island coverage: %s',(_name,latitude,longitude)=>{
  expect(isInsideOsmCoverage({latitude,longitude},'japan')).toBe(true)
})
it('keeps Okinawa auto detection and all three local identities distinct',async()=>{
  const {localOsmRegionId}=await import('./osm-datasets')
  expect(new Set(['okinawa','taiwan','japan'].map(id=>localOsmRegionId(id as 'okinawa'|'taiwan'|'japan'))).size).toBe(3)
  expect(datasetForCoordinate({latitude:26.4,longitude:127.9})).toBe('okinawa')
  expect(datasetForCoordinate({latitude:35.6812,longitude:139.7671})).toBe('japan')
  for(const coordinate of [{latitude:25.03,longitude:121.56},{latitude:37.5665,longitude:126.978},{latitude:30,longitude:140}]){
    expect(isInsideOsmCoverage(coordinate,'japan')).toBe(false)
  }
})
