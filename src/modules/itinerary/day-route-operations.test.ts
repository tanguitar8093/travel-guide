import { expect, it, vi } from 'vitest'
import type { ItineraryItem } from '../../database'
import { dayTravelSummary, runDayJobs } from './day-route-operations'

const item = (id: string, minutes?: number): ItineraryItem => ({
  id, tripId: 'trip', date: '2026-10-25', placeId: id, order: 0,
  travelDurationMinutes: minutes,
})

it('sums only calculated adjacent legs, including zero, excluding a stale first-stop estimate', () => {
  expect(dayTravelSummary([item('first', 999), item('second', 75), item('third'), item('fourth', 0), item('fifth', 50)]))
    .toEqual({ minutes: 125, calculated: 3, total: 4, label: '路程約 2 小時 5 分鐘' })
  expect(dayTravelSummary([])).toMatchObject({ minutes: 0, calculated: 0, total: 0 })
})

it('limits requests, continues after a failed leg, and reports progress for every job', async () => {
  let active = 0
  let peak = 0
  const processed: number[] = []
  const progress = vi.fn()
  const jobs = Array.from({ length: 25 }, (_, i) => i)
  const result = await runDayJobs(jobs, async job => {
    active++
    peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 1))
    processed.push(job)
    active--
    if (job === 5) throw new Error('無可用路線')
  }, 3, progress)
  expect(peak).toBe(3)
  expect(processed.sort((a, b) => a - b)).toEqual(jobs)
  expect(result).toEqual({ succeeded: 24, failures: [{ job: 5, message: '無可用路線' }] })
  expect(progress.mock.calls.flat()).toEqual(jobs.map(i => i + 1))
})

it('serializes shared document writes against the latest revision', async () => {
  let revision = 0
  await runDayJobs([0, 1, 2], async expected => {
    expect(revision).toBe(expected)
    await Promise.resolve()
    revision++
  }, 1, () => {})
  expect(revision).toBe(3)
})

it('handles an empty day without requests or spurious progress', async () => {
  const run = vi.fn()
  const progress = vi.fn()
  expect(await runDayJobs([], run, 3, progress)).toEqual({ succeeded: 0, failures: [] })
  expect(run).not.toHaveBeenCalled()
  expect(progress).not.toHaveBeenCalled()
})
