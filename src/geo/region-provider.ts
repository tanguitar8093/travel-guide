import type { GeoProvider } from './contracts'
import type { Region } from '../database/models'

export function getRegionMapProvider(region: Region): GeoProvider {
  return region.mapProvider ?? 'google'
}

export function regionsForMapProvider(regions: readonly Region[], provider: GeoProvider | undefined): Region[] {
  return provider ? regions.filter(region => getRegionMapProvider(region) === provider) : []
}

export function defaultRegionIds(regions: readonly Region[], provider: GeoProvider | undefined): string[] {
  const firstRegion = regionsForMapProvider(regions, provider)[0]
  return firstRegion ? [firstRegion.id] : []
}
