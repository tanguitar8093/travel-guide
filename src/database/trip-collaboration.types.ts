export type TripMemberRole = 'viewer' | 'editor'
export type TripAccess = TripMemberRole | 'owner'

export interface CollaborationTrip {
  ownerEmail?: string
  id: string
  name: string
  regionId: string
  startDate: string
  endDate: string
  ownerUid: string
  access: TripAccess
  aclVersion: string
}

export interface TripMember {
  email?: string
  userId: string
  role: TripMemberRole
  createdBy: string
  createdAt: string
}

export interface TripInvitation {
  inviteeEmail?: string
  id: string
  tripId: string
  tripName: string
  invitedBy: string
  inviteeUserId: string
  role: TripMemberRole
  expiresAt: string
  acceptedAt?: string
  revokedAt?: string
  createdAt: string
}

export interface SharedTripPlace {
  id: string
  name: string
  googlePlaceId?: string
  mapsUrl?: string
  icon?: string
}

export interface SharedTripItem {
  id: string
  placeId: string
  date: string
  order: number
  arrivalTime?: string
  durationMinutes?: number
  transport?: string
  travelDurationMinutes?: number
  travelDistanceMeters?: number
  note?: string
}

export interface CollaborationList {
  trips: CollaborationTrip[]
  invitations: TripInvitation[]
}

export interface CollaborationDetails {
  trip: CollaborationTrip
  members: TripMember[]
  invitations: TripInvitation[]
  places: SharedTripPlace[]
  items: SharedTripItem[]
}
