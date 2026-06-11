import type { Role } from '@/shared/membership/entities'

/**
 * 招待ステータス。
 */
export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'CANCELED'

/**
 * Invitationドメインエンティティ。
 * 組織への招待とそのステータスを表す。
 */
export type Invitation = {
  id: number
  organizationId: number
  email: string
  role: Role
  status: InvitationStatus
  token: string
  expiresAt: Date
  createdAt: Date
}
