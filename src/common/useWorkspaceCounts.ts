import { useEffect, useState } from 'react'
import { labels, places, regions, trips, prepareMapWorkspace } from '../database'
import { useDatabaseMode } from '../database/useDatabaseMode'
import { useHybridDataRevision } from '../database/useHybridDataRevision'
import { useHybridStatus } from '../database/useHybridStatus'
import { placesForMapProvider } from '../geo/place-provider'
import { getRegionMapProvider, regionsForMapProvider } from '../geo/region-provider'
import type { GeoProvider } from '../geo/contracts'
import type { OsmDatasetId } from '../geo/osm-datasets'
import { createPublicItineraryController } from '../modules/public-itinerary/public-itinerary.controller'

type PersonalCounts = { places: number; labels: number; itinerary: number }

export function useWorkspaceCounts(userId: string | undefined, provider: GeoProvider | undefined, dataset: OsmDatasetId | undefined, section: string, sidebarOpen: boolean) {
  const mode = useDatabaseMode()
  const revision = useHybridDataRevision()
  const { ready } = useHybridStatus()
  const scope = `${userId}:${mode}:${provider}:${dataset}`
  const [personal, setPersonal] = useState<{ scope: string; counts: PersonalCounts }>()
  const [publicCount, setPublicCount] = useState<{ scope: string; count: number }>()

  useEffect(() => {
    if (!userId || !provider || (provider === 'osm' && !dataset) || (mode === 'hybrid' && !ready)) return
    let active = true
    async function load() {
      await prepareMapWorkspace()
      const [regionRecords, placeRecords, labelRecords, tripRecords] = await Promise.all([
        regions.list(), places.list(), labels.list(), trips.list(),
      ])
      const visibleRegions = regionsForMapProvider(regionRecords, provider, dataset)
      const regionIds = new Set(visibleRegions.map(region => region.id))
      if (active) setPersonal({ scope, counts: {
        places: placesForMapProvider(placeRecords, provider, regionRecords, dataset).length,
        labels: labelRecords.length,
        itinerary: tripRecords.filter(trip => regionIds.has(trip.regionId)).length,
      } })
    }
    void load().catch(() => { if (active) setPersonal(undefined) })
    return () => { active = false }
  }, [userId, provider, dataset, mode, ready, revision, section, sidebarOpen, scope])

  useEffect(() => {
    if (!userId || !provider) return
    return createPublicItineraryController(userId).subscribe(rows => {
      setPublicCount({ scope, count: rows.filter(row => getRegionMapProvider(row.snapshot.region) === provider).length })
    }, () => setPublicCount(undefined))
  }, [userId, provider, scope])

  return {
    places: undefined,
    labels: undefined,
    itinerary: undefined,
    ...(personal?.scope === scope && (mode !== 'hybrid' || ready) ? personal.counts : {}),
    'public-itinerary': publicCount?.scope === scope ? publicCount.count : undefined,
  }
}
