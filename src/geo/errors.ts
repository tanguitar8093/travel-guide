import type { GeoError, GeoErrorCode } from './contracts'

export function geoError(code: GeoErrorCode, message: string, cause?: unknown): GeoError {
  return Object.assign(new Error(message, { cause }), { name: 'GeoError', code })
}

export function toGeoError(cause: unknown): GeoError {
  if (cause instanceof Error && cause.name === 'GeoError' && 'code' in cause) {
    return cause as GeoError
  }
  return geoError('SERVICE_UNAVAILABLE', cause instanceof Error ? cause.message : '地圖服務無法使用。', cause)
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw geoError('CANCELLED', '已取消地圖載入。')
}

export function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort)
      reject(geoError('CANCELLED', '已取消地圖載入。'))
    }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(
      value => { signal.removeEventListener('abort', abort); resolve(value) },
      cause => { signal.removeEventListener('abort', abort); reject(cause) },
    )
  })
}
