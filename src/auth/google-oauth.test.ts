import { expect, it, vi } from 'vitest'
const { oauth, register, create } = vi.hoisted(() => ({
  oauth: vi.fn(), register: vi.fn(), create: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: create }))
vi.mock('../database/supabase.client', () => ({
  supabase: { auth: { signInWithOAuth: oauth } },
}))
import { signInWithGoogle, signUpWithPassword } from './auth.gateway'

it('starts Google OAuth with the current app redirect and returns provider errors', async () => {
  oauth.mockResolvedValueOnce({ error: null })
  expect(await signInWithGoogle('https://preview.example')).toBeNull()
  expect(oauth).toHaveBeenCalledWith({
    provider: 'google', options: { redirectTo: 'https://preview.example' },
  })
  const error = new Error('Provider is not enabled')
  oauth.mockResolvedValueOnce({ error })
  expect(await signInWithGoogle('https://preview.example')).toBe(error)
})

it('creates accounts with an isolated client without persisting a replacement session', async () => {
  create.mockReturnValue({ auth: { signUp: register } })
  register.mockResolvedValue({ data: { session: null }, error: null })
  const result = await signUpWithPassword('new@example.com', 'password', 'https://preview.example')
  expect(create).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  expect(register).toHaveBeenCalledWith({
    email: 'new@example.com', password: 'password',
    options: { emailRedirectTo: 'https://preview.example' },
  })
  expect(result).toEqual({ requiresEmailConfirmation: true, error: null })
})
