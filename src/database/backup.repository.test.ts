import { describe, expect, it } from 'vitest'
import { backupRepository } from './backup.repository'

describe('backup repository validation', () => {
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
    expect(backup.version).toBe(1)
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
