import type { ItineraryItem } from '../../database'

/** Each destination owns the leg from its previous stop; the first stop has no leg. */
export function dayTravelSummary(items: readonly ItineraryItem[]) {
  const legs = items.slice(1)
  const calculated = legs.filter(item => item.travelDurationMinutes !== undefined)
  const minutes = Math.round(calculated.reduce((sum, item) => sum + item.travelDurationMinutes!, 0))
  return { minutes, calculated: calculated.length, total: legs.length,
    label: `路程約 ${Math.floor(minutes / 60)} 小時 ${minutes % 60} 分鐘` }
}

/** A bounded worker pool: O(n) jobs, no unbounded request fan-out. */
export async function runDayJobs<T>(
  jobs: readonly T[], run: (job: T) => Promise<unknown>,
  concurrency: number, onProgress: (done: number) => void,
) {
  let next = 0
  let done = 0
  const failures: { job: T; message: string }[] = []
  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++]
      try { await run(job) }
      catch (error) { failures.push({ job, message: error instanceof Error ? error.message : '操作失敗。' }) }
      onProgress(++done)
    }
  }
  await Promise.all(Array.from({ length: Math.min(jobs.length, Math.max(1, concurrency)) }, worker))
  return { succeeded: done - failures.length, failures }
}
