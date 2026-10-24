import type { ImportCandidate } from '../../../shared/place-import/place-url.js'
export const sharePath = '/share/place'
export const shareLifetime = 24 * 60 * 60 * 1000
const prefix = 'tripmap:share:v1:'
const returnKey = 'tripmap:share:oauth-return'
export const isShareId = (id: string): boolean => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
export interface ImportResult { status: 'created' | 'already_imported' | 'duplicate'; placeId: string; name: string }
export interface PendingShare {
  id: string; createdAt: number; title: string; text: string; url: string
  accountId?: string; candidate?: ImportCandidate; result?: ImportResult
}
export function readShare(id: string): PendingShare | undefined {
  if (!isShareId(id)) return
  const raw = localStorage.getItem(prefix + id)
  if (!raw) return
  let data: PendingShare
  try { data = JSON.parse(raw) } catch { throw new Error('分享資料損壞，請重新分享。') }
  if (!data || data.id !== id || !Number.isFinite(data.createdAt) || ['title', 'text', 'url'].some(key => typeof data[key as 'title'] !== 'string')) throw new Error('分享資料格式無效，請重新分享。')
  return data
}
export function saveShare(share: PendingShare): void {
  localStorage.setItem(prefix + share.id, JSON.stringify(share))
}
export async function receiveShare(): Promise<PendingShare> {
  const id = new URLSearchParams(location.search).get('receipt') ?? ''
  if (!isShareId(id)) throw new Error('請從 Google Maps 的分享選單選擇 TripMap。')
  const existing = readShare(id)
  if (existing) return existing
  const cache = await caches.open('tripmap-share-inbox-v1')
  const key = new URL(`/share/inbox/${id}`, location.origin).href
  const response = await cache.match(key)
  if (!response) throw new Error('找不到這筆分享，請從 Google Maps 重新分享。')
  const data = await response.json()
  if (!data || !Number.isFinite(data.createdAt) || ['title', 'text', 'url'].some(key => typeof data[key] !== 'string' || data[key].length > 16384)) throw new Error('分享資料格式無效。')
  const share: PendingShare = { id, createdAt: data.createdAt, title: data.title, text: data.text, url: data.url }
  saveShare(share)
  await cache.delete(key)
  return share
}
export function prepareShareLogin(id: string): void {
  if (!isShareId(id)) throw new Error('分享識別碼無效。')
  const target = `${sharePath}?receipt=${id}`
  sessionStorage.setItem(returnKey, target)
  localStorage.setItem(returnKey, JSON.stringify({ target, createdAt: Date.now() }))
}
export function restoreShareAfterLogin(): void {
  if (location.pathname !== '/') return
  try {
    let target = sessionStorage.getItem(returnKey)
    const callback = new URL(location.href)
    if (!target && (callback.searchParams.has('code') || callback.searchParams.has('error') || /(?:access_token|error)=/.test(callback.hash))) {
      const fallback = JSON.parse(localStorage.getItem(returnKey) ?? 'null')
      if (fallback && Date.now() - fallback.createdAt < 30 * 60 * 1000) target = fallback.target
    }
    if (!target || !new RegExp(`^${sharePath}\\?receipt=[0-9a-f-]{36}$`, 'i').test(target)) return
    sessionStorage.removeItem(returnKey)
    localStorage.removeItem(returnKey)
    const destination = new URL(target, location.origin)
    for (const key of ['code', 'error', 'error_description']) {
      const value = callback.searchParams.get(key)
      if (value !== null) destination.searchParams.set(key, value)
    }
    destination.hash = callback.hash // Preserve the existing Supabase callback/welcome detection.
    history.replaceState(null, '', destination.pathname + destination.search + destination.hash)
  } catch { /* Persistence failures are reported by the receiver. */ }
}
