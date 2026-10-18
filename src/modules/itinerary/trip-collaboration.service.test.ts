import { beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ mode: 'hybrid' }))
vi.mock('../../database', () => ({
  getDatabaseMode: () => state.mode,
  TripCollaborationRepository: class {},
  ValidationError: class extends Error {},
}))
import { TripCollaborationService } from './trip-collaboration.service'
import type { TripCollaborationRepository } from '../../database'

const repository = {
  list: vi.fn(), details: vi.fn(), invite: vi.fn(), accept: vi.fn(),
  revokeInvitation: vi.fn(), setMember: vi.fn(), removeMember: vi.fn(), leave: vi.fn(),
} satisfies Pick<TripCollaborationRepository, 'list' | 'details' | 'invite' | 'accept' |
  'revokeInvitation' | 'setMember' | 'removeMember' | 'leave'>

beforeEach(() => {
  state.mode = 'hybrid'
  vi.clearAllMocks()
})

it('refuses standalone data without calling the cloud', () => {
  state.mode = 'indexeddb'
  const service = new TripCollaborationService(repository)
  expect(() => service.list()).toThrow('純本機資料不會上傳')
  expect(() => service.invite('trip', 'user', 'viewer')).toThrow('不能跨帳號分享')
  expect(repository.list).not.toHaveBeenCalled()
})

it.each(['supabase', 'hybrid'])('uses the same server ACL control plane in %s without rewriting business data', async (mode) => {
  state.mode = mode
  repository.list.mockResolvedValue({ trips: [], invitations: [] })
  repository.invite.mockResolvedValue(undefined)
  const service = new TripCollaborationService(repository)
  await expect(service.list()).resolves.toEqual({ trips: [], invitations: [] })
  await service.invite('trip', 'user', 'viewer')
  expect(repository.invite).toHaveBeenCalledWith('trip', 'user', 'viewer')
})
