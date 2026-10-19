import type { TripMemberRole } from '../../database'
import { TripCollaborationService } from './trip-collaboration.service'

export class TripCollaborationController {
  private readonly service: TripCollaborationService

  constructor(service = new TripCollaborationService()) {
    this.service = service
  }

  list() { return this.service.list() }
  details(tripId: string) { return this.service.details(tripId) }
  invite(tripId: string, email: string, role: TripMemberRole) { return this.service.invite(tripId, email, role) }
  accept(tripId: string, invitationId: string) { return this.service.accept(tripId, invitationId) }
  revokeInvitation(tripId: string, invitationId: string) { return this.service.revokeInvitation(tripId, invitationId) }
  setMember(tripId: string, userId: string, role: TripMemberRole) { return this.service.setMember(tripId, userId, role) }
  removeMember(tripId: string, userId: string) { return this.service.removeMember(tripId, userId) }
  leave(tripId: string) { return this.service.leave(tripId) }
}

export const tripCollaborationController = new TripCollaborationController()
