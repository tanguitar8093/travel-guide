import { getDatabaseMode, TripCollaborationRepository, ValidationError } from '../../database'
import type { TripMemberRole } from '../../database'

type CollaborationRepository = Pick<TripCollaborationRepository,
  'list' | 'details' | 'invite' | 'accept' | 'revokeInvitation' | 'setMember' | 'removeMember' | 'leave'>

export class TripCollaborationService {
  private readonly repository: CollaborationRepository

  constructor(repository: CollaborationRepository = new TripCollaborationRepository()) {
    this.repository = repository
  }

  private assertCloudAccount() {
    if (getDatabaseMode() === 'indexeddb') {
      throw new ValidationError('純本機資料不會上傳，也不能跨帳號分享。請使用雲端或混合模式。')
    }
  }

  list() {
    this.assertCloudAccount()
    return this.repository.list()
  }

  details(tripId: string) {
    this.assertCloudAccount()
    return this.repository.details(tripId)
  }

  invite(tripId: string, userId: string, role: TripMemberRole) {
    this.assertCloudAccount()
    return this.repository.invite(tripId, userId, role)
  }

  accept(tripId: string, invitationId: string) {
    this.assertCloudAccount()
    return this.repository.accept(tripId, invitationId)
  }

  revokeInvitation(tripId: string, invitationId: string) {
    this.assertCloudAccount()
    return this.repository.revokeInvitation(tripId, invitationId)
  }

  setMember(tripId: string, userId: string, role: TripMemberRole) {
    this.assertCloudAccount()
    return this.repository.setMember(tripId, userId, role)
  }

  removeMember(tripId: string, userId: string) {
    this.assertCloudAccount()
    return this.repository.removeMember(tripId, userId)
  }

  leave(tripId: string) {
    this.assertCloudAccount()
    return this.repository.leave(tripId)
  }
}
