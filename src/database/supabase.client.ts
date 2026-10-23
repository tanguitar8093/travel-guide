import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    '缺少環境變數 VITE_SUPABASE_URL 或 VITE_SUPABASE_ANON_KEY。',
  )
}

const supabaseProjectRef = new URL(supabaseUrl).hostname.split('.')[0]

export const supabaseAuthStorageKey = `sb-${supabaseProjectRef}-auth-token`
export const supabaseAuthCodeVerifierKey = `${supabaseAuthStorageKey}-code-verifier`

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
