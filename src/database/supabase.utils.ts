import { supabase } from './supabase.client'
import { ValidationError } from './errors'

const SUPABASE_TIMEOUT_MS = 8000

export interface SupabaseErrorLike {
  code?: string
  message: string
}

export function withSupabaseTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`Supabase 請求逾時（${label}），請稍後再試。`))
    }, SUPABASE_TIMEOUT_MS)

    promise
      .then((value) => {
        window.clearTimeout(timer)
        resolve(value)
      })
      .catch((error) => {
        window.clearTimeout(timer)
        reject(error)
      })
  })
}

export async function requireAuthenticatedUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser()
  if (error) {
    throw new ValidationError(error.message)
  }

  const userId = data.user?.id
  if (!userId) {
    throw new ValidationError('請先登入 Supabase。')
  }

  return userId
}

export function mapSupabasePermissionError(error: SupabaseErrorLike): Error | undefined {
  if (error.code === '42501') {
    return new ValidationError('目前沒有權限執行此操作。')
  }

  return undefined
}
