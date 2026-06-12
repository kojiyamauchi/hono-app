import type { InvitationStatus } from '@/shared/invitation/entities'
import type { Role } from '@/shared/membership/entities'

/**
 * APIレスポンス用のInvitation表現。
 * DBカラム名 `token` はレスポンスでは `invitationToken` として公開する。
 */
export type InvitationResponse = {
  id: number
  organizationId: number
  email: string
  role: Role
  status: InvitationStatus
  invitationToken: string
  expiresAt: Date
  createdAt: Date
}
