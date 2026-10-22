import { BackupRepository } from './backup.repository'
import { hasGeoFormatFields } from './geo-format'
import type { TravelBackup } from './backup.repository'
import { ValidationError } from './errors'
import { requireHybridStore, runHybridMutation } from './hybrid.runtime'
import type { LabelRepository } from './label.repository'
import type { ItineraryItemRepository, PlaceRepository, RegionRepository, TripRepository } from './repositories'
import type { RouteMapRepository, RouteMapPlaceRepository } from './route-map.repository'

type Repositories = {
  regions: RegionRepository
  places: PlaceRepository
  labels: LabelRepository
  trips: TripRepository
  itineraryItems: ItineraryItemRepository
  routeMaps: RouteMapRepository
  routeMapPlaces: RouteMapPlaceRepository
}

const writeMethods = new Set(['create', 'update', 'delete', 'addLabel', 'removeLabel', 'reorderForDate'])

function repositoryAdapter<Name extends keyof Repositories>(name: Name): Repositories[Name] {
  return new Proxy({} as Repositories[Name], {
    get(_target, property) {
      return (...args: unknown[]) => {
        const work = (repositories: Repositories) => {
          const repository = repositories[name]
          const method = Reflect.get(repository, property) as (...values: unknown[]) => Promise<unknown>
          return method.apply(repository, args)
        }
        return writeMethods.has(String(property))
          ? runHybridMutation(`${name}.${String(property)}`, work)
          : requireHybridStore().read(work)
      }
    },
  })
}

function rejectReplacement(): never {
  throw new ValidationError('混合測試模式暫不支援覆蓋匯入或清空，請先匯出備份。')
}

export const hybridBackend = {
  regions: repositoryAdapter('regions'),
  places: repositoryAdapter('places'),
  labels: repositoryAdapter('labels'),
  trips: repositoryAdapter('trips'),
  itineraryItems: repositoryAdapter('itineraryItems'),
  routeMaps: repositoryAdapter('routeMaps'),
  routeMapPlaces: repositoryAdapter('routeMapPlaces'),
  backupRepository: {
    exportAll(): Promise<TravelBackup> {
      return requireHybridStore().read(async (repositories) => {
        const [regions, places, labels, trips, routeMaps, routeMapPlaces] = await Promise.all([
          repositories.regions.list(), repositories.places.list(), repositories.labels.list(), repositories.trips.list(),
          repositories.routeMaps.list(), repositories.routeMapPlaces.list(),
        ])
        const itineraryItems = (await Promise.all(trips.map((trip) => repositories.itineraryItems.findByTripId(trip.id)))).flat()
        return new BackupRepository().validateImport({
          format: 'travel-planner-backup',
          version: [...regions, ...places, ...routeMaps, ...routeMapPlaces].some(hasGeoFormatFields) ? 3 : 2,
          exportedAt: new Date().toISOString(),
          data: { regions, places, labels, trips, itineraryItems, routeMaps, routeMapPlaces },
        })
      })
    },
    validateImport(value: unknown) { return new BackupRepository().validateImport(value) },
    async replaceAll(): Promise<never> { return rejectReplacement() },
    async clearAllData(): Promise<never> { return rejectReplacement() },
  },
}
