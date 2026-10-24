import type { ImportCandidate } from '../../../shared/place-import/place-url.js'
import { createImportPayload } from '../../../shared/place-import/payload.js'
import { supabase } from '../../database/supabase.client'
import { searchOsmLocations } from '../../geo/osm-service'
import { readShare, saveShare, type ImportResult, type PendingShare } from './share-store'

export function extractMapsUrl(share: Pick<PendingShare, 'url' | 'text' | 'title'>): string {
  const urls = `${share.url}\n${share.text}\n${share.title}`.match(/https:\/\/[^\s<>"\u3000]+/g) ?? []
  const accepted = urls.filter(value => {
    try {
      const url = new URL(value)
      return !url.username && !url.password && !url.port && (
        url.hostname === 'maps.app.goo.gl' || (url.hostname === 'goo.gl' && url.pathname.startsWith('/maps/')) ||
        ['google.com', 'google.com.tw', 'google.co.jp', 'google.co.uk'].some(domain => [domain, `www.${domain}`, `maps.${domain}`].includes(url.hostname) && (url.hostname.startsWith('maps.') || url.pathname === '/maps' || url.pathname.startsWith('/maps/')))
      )
    } catch { return false }
  })
  const unique = [...new Set(accepted)]
  if (unique.length !== 1) throw new Error('分享內容需要包含一個 Google Maps 地點網址。')
  return unique[0]
}
const preparing = new Map<string, Promise<ImportCandidate>>()
export function prepareSharedPlace(id: string): Promise<ImportCandidate> {
  const previous = preparing.get(id)
  if (previous) return previous
  const work = async () => {
    const share = readShare(id)
    if (!share) throw new Error('分享資料已不存在，請重新分享。')
    if (share.candidate) return share.candidate
    // All long/short Maps URLs use the same Mapu adapter as the existing place form.
    const [candidate] = await searchOsmLocations(extractMapsUrl(share))
    const coordinate = candidate?.location.coordinate
    if (!candidate || !coordinate || !candidate.mapsUrl || candidate.name === `${coordinate.latitude}, ${coordinate.longitude}`) throw new Error('無法取得地點名稱與座標，請重新分享單一地點。')
    if (candidate.warning) throw new Error(candidate.warning)
    const resolved = { name: candidate.name, coordinate, sourceUrl: candidate.mapsUrl }
    const latest = readShare(id)
    if (latest && !latest.result) saveShare({ ...latest, candidate: resolved })
    return resolved
  }
  const promise = work().finally(() => preparing.delete(id))
  preparing.set(id, promise)
  return promise
}
const running = new Map<string, { promise: Promise<ImportResult>; listeners: Set<(message: string) => void>; message: string }>()
export function importSharedPlace(id: string, accountId: string, progress: (message: string) => void): Promise<ImportResult> {
  const key = `${accountId}:${id}`
  const previous = running.get(key)
  if (previous) { previous.listeners.add(progress); progress(previous.message); return previous.promise }
  const listeners = new Set([progress])
  const report = (message: string) => {
    const entry = running.get(key)
    if (entry) entry.message = message
    for (const listener of listeners) listener(message)
  }
  const work = async () => {
    const share = readShare(id)
    if (!share) throw new Error('分享資料已不存在，請重新分享。')
    if (share.accountId && share.accountId !== accountId) throw new Error('這筆分享綁定另一個登入帳號，請切回原帳號或重新分享。')
    if (share.result) return share.result
    share.accountId = accountId
    saveShare(share)
    report('正在解析網址…')
    const candidate = await prepareSharedPlace(id)
    report('正在加入地點…')
    const { data: auth, error: authError } = await supabase.auth.getSession()
    if (authError || auth.session?.user.id !== accountId) throw new Error('登入已失效，請重新登入後重試。')
    const payload = createImportPayload(candidate, id)
    const send = () => supabase.rpc('app_import_place', payload).abortSignal(AbortSignal.timeout(20000))
    let response = await send()
    if (response.status === 401) {
      const refreshed = await supabase.auth.refreshSession()
      if (refreshed.error || refreshed.data.session?.user.id !== accountId) throw new Error('登入已失效，請重新登入後重試。')
      response = await send()
    }
    if (response.error) throw new Error(response.error.message || '新增失敗，請稍後重試。')
    const result = response.data as ImportResult
    if (!result || !['created', 'already_imported', 'duplicate'].includes(result.status) || typeof result.placeId !== 'string' || typeof result.name !== 'string') throw new Error('新增 API 回傳格式無效，請重試確認結果。')
    saveShare({ id, createdAt: share.createdAt, accountId, title: '', text: '', url: '', result })
    return result
  }
  const promise = (navigator.locks ? navigator.locks.request(`tripmap-share:${key}`, work) : work()).finally(() => running.delete(key))
  running.set(key, { promise, listeners, message: '正在解析網址…' })
  return promise
}
