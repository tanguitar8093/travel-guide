import { describe, expect, it } from 'vitest'
import { backupRepository } from './backup.repository'
import { validateItineraryItem } from './validation'

describe('backup repository validation', () => {
  const distanceBackup = (distance?: number) => ({
    format: 'travel-planner-backup', version: 1,
    exportedAt: '2026-10-18T00:00:00.000Z',
    data: {
      regions: [{ id: 'region', name: 'Kyoto', zoom: 12, googlePlaceId: 'kyoto' }],
      places: [{ id: 'place', name: 'Cafe', googlePlaceId: 'cafe', regionIds: ['region'], labelIds: [] }],
      labels: [],
      trips: [{ id: 'trip', regionId: 'region', name: 'Trip', startDate: '2026-10-18', endDate: '2026-10-18' }],
      itineraryItems: [{
        id: 'item', tripId: 'trip', placeId: 'place', date: '2026-10-18', order: 0,
        travelDurationMinutes: 10, ...(distance !== undefined ? { travelDistanceMeters: distance } : {}),
      }],
    },
  })

  it('preserves distance in backups while accepting old backups without it', () => {
    expect(backupRepository.validateImport(distanceBackup(12300)).data.itineraryItems[0].travelDistanceMeters).toBe(12300)
    expect(backupRepository.validateImport(distanceBackup()).data.itineraryItems[0].travelDistanceMeters).toBeUndefined()
    expect(backupRepository.validateImport(distanceBackup(0)).data.itineraryItems[0].travelDistanceMeters).toBe(0)
  })

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid distance %s', (distance) => {
    expect(() => validateItineraryItem(distanceBackup(distance).data.itineraryItems[0])).toThrow('路程距離')
  })

  it('accepts a valid backup', () => {
    const backup = backupRepository.validateImport({
      format: 'travel-planner-backup',
      version: 1,
      exportedAt: '2026-10-16T00:00:00.000Z',
      data: {
        regions: [],
        places: [],
        labels: [],
        trips: [],
        itineraryItems: [],
      },
    })

    expect(backup.format).toBe('travel-planner-backup')
    expect(backup.version).toBe(2)
    expect(backup.data.regions).toHaveLength(0)
  })

  it('rejects malformed backup data', () => {
    expect(() =>
      backupRepository.validateImport({
        format: 'travel-planner-backup',
        version: 1,
        exportedAt: '2026-10-16T00:00:00.000Z',
        data: {
          regions: [],
          places: [],
          labels: [],
          trips: [],
          itineraryItems: [
            {
              id: 'item-1',
              tripId: 'trip-1',
              placeId: 'place-1',
              date: '2026-10-17',
              order: 0,
            },
          ],
        },
      }),
    ).toThrowError()
  })
})
