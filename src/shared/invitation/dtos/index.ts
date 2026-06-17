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

/**
 * 招待詳細取得エンドポイント用の公開レスポンス型。
 * トークンは含めず、organization情報（id・name）を含む。
 */
export type InvitationDetailResponse = {
  id: number
  organization: {
    id: number
    name: string
  }
  email: string
  role: Role
  status: InvitationStatus
  expiresAt: Date
  createdAt: Date
}
