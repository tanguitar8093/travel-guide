import { ValidationError } from './errors'
import { supabase } from './supabase.client'
import { mapSupabasePermissionError, withSupabaseTimeout } from './supabase.utils'
import type {
  CollaborationDetails, CollaborationList, CollaborationTrip, SharedTripItem,
  SharedTripPlace, TripAccess, TripInvitation, TripMember, TripMemberRole,
} from './trip-collaboration.types'

export const tripCollaborationEnabled = import.meta.env.VITE_TRIP_COLLABORATION_ENABLED === 'true'

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError('協作 API 回傳格式不正確。')
  }
  return value as Record<string, unknown>
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new ValidationError('協作 API 缺少文字欄位。')
  return value
}

function optionalText(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : text(value)
}

function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ValidationError('協作 API 回傳無效的數值。')
  }
  return value
}

function optionalNumber(value: unknown): number | undefined {
  return value === null || value === undefined ? undefined : number(value)
}

function list<T>(value: unknown, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new ValidationError('協作 API 缺少清單欄位。')
  return value.map(parse)
}

export function validateTripMemberRole(value: unknown): TripMemberRole {
  if (value !== 'viewer' && value !== 'editor') throw new ValidationError('協作角色只能是唯讀或可編輯。')
  return value
}

function access(value: unknown): TripAccess {
  return value === 'owner' ? 'owner' : validateTripMemberRole(value)
}

function trip(value: unknown): CollaborationTrip {
  const row = object(value)
  return {
    id: text(row.id), name: text(row.name), regionId: text(row.regionId),
    startDate: text(row.startDate), endDate: text(row.endDate),
    ownerUid: text(row.ownerUid), ownerEmail: optionalText(row.ownerEmail),
    access: access(row.access), aclVersion: text(row.aclVersion),
  }
}

function invitation(value: unknown): TripInvitation {
  const row = object(value)
  return {
    id: text(row.id), tripId: text(row.tripId), tripName: text(row.tripName),
    invitedBy: text(row.invitedBy), inviteeUserId: text(row.inviteeUserId), inviteeEmail: optionalText(row.inviteeEmail),
    role: validateTripMemberRole(row.role), expiresAt: text(row.expiresAt),
    acceptedAt: optionalText(row.acceptedAt), revokedAt: optionalText(row.revokedAt),
    createdAt: text(row.createdAt),
  }
}

function member(value: unknown): TripMember {
  const row = object(value)
  return {
    userId: text(row.userId), email: optionalText(row.email), role: validateTripMemberRole(row.role),
    createdBy: text(row.createdBy), createdAt: text(row.createdAt),
  }
}

function place(value: unknown): SharedTripPlace {
  const row = object(value)
  return {
    id: text(row.id), name: text(row.name), googlePlaceId: optionalText(row.googlePlaceId),
    mapsUrl: optionalText(row.mapsUrl), icon: optionalText(row.icon),
  }
}

function item(value: unknown): SharedTripItem {
  const row = object(value)
  return {
    id: text(row.id), placeId: text(row.placeId), date: text(row.date), order: number(row.order),
    arrivalTime: optionalText(row.arrivalTime), durationMinutes: optionalNumber(row.durationMinutes),
    transport: optionalText(row.transport), travelDurationMinutes: optionalNumber(row.travelDurationMinutes),
    travelDistanceMeters: optionalNumber(row.travelDistanceMeters), note: optionalText(row.note),
  }
}

export function parseCollaborationList(value: unknown): CollaborationList {
  const result = object(value)
  return { trips: list(result.trips, trip), invitations: list(result.invitations, invitation) }
}

export function parseCollaborationDetails(value: unknown): CollaborationDetails {
  const result = object(value)
  return {
    trip: trip(result.trip), members: list(result.members, member),
    invitations: list(result.invitations, invitation), places: list(result.places, place),
    items: list(result.items, item),
  }
}

export function validateCollaborationId(value: string): string {
  const id = value.trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new ValidationError('請輸入有效的帳號或行程 UUID。')
  }
  return id
}

export function validateInvitationEmail(value: string): string {
  const email = value.trim().toLowerCase()
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError('請輸入有效的 Email。')
  }
  return email
}

export class TripCollaborationRepository {
  private async call(action: string, tripId?: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    if (!tripCollaborationEnabled) throw new ValidationError('行程協作尚未啟用。')
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
    if (sessionError) throw new ValidationError(sessionError.message)
    const userId = sessionData.session?.user.id
    if (!userId) throw new ValidationError('請先登入後使用行程協作。')
    const { data, error } = await withSupabaseTimeout(
      Promise.resolve(supabase.rpc('app_trip_collaboration_v2', {
        p_action: action,
        p_trip_id: tripId ? validateCollaborationId(tripId) : null,
        p_payload: payload,
      })),
      'trip collaboration',
    )
    const current = await supabase.auth.getSession()
    if (current.error) throw new ValidationError(current.error.message)
    if (current.data.session?.user.id !== userId) throw new ValidationError('登入帳號已變更，請重新載入協作資料。')
    if (error) {
      if (error.code === 'PGRST202' || error.code === '42883') {
        throw new ValidationError('雲端尚未安裝 Email 邀請更新。既有旅行資料未變更，請勿重播基礎 schema。')
      }
      throw mapSupabasePermissionError(error) ?? new ValidationError(error.message)
    }
    return data
  }

  async list(): Promise<CollaborationList> {
    return parseCollaborationList(await this.call('list'))
  }

  async details(tripId: string): Promise<CollaborationDetails> {
    return parseCollaborationDetails(await this.call('details', tripId))
  }

  async invite(tripId: string, email: string, role: TripMemberRole): Promise<void> {
    await this.call('invite', tripId, { email: validateInvitationEmail(email), role: validateTripMemberRole(role) })
  }

  async accept(tripId: string, invitationId: string): Promise<void> {
    await this.call('accept', tripId, { invitationId: validateCollaborationId(invitationId) })
  }

  async revokeInvitation(tripId: string, invitationId: string): Promise<void> {
    await this.call('revoke_invitation', tripId, { invitationId: validateCollaborationId(invitationId) })
  }

  async setMember(tripId: string, userId: string, role: TripMemberRole): Promise<void> {
    await this.call('set_member', tripId, { userId: validateCollaborationId(userId), role: validateTripMemberRole(role) })
  }

  async removeMember(tripId: string, userId: string): Promise<void> {
    await this.call('remove_member', tripId, { userId: validateCollaborationId(userId) })
  }

  async leave(tripId: string): Promise<void> {
    await this.call('leave', tripId)
  }
}
