import type { InvitationEmailDeliveryStatus } from '@/shared/invitation/entities/emailDelivery'
import type { Role } from '@/shared/membership/entities'
import type { Organization } from '@/shared/organization/entities'

/**
 * 招待ステータスの値一覧。
 * InvitationStatus型・DTOのZod schema（`z.enum`）双方の正本として使い、列挙値の二重管理を防ぐ。
 */
export const invitationStatusValues = ['PENDING', 'ACCEPTED', 'EXPIRED', 'CANCELED', 'DECLINED'] as const

/**
 * 招待ステータス。
 */
export type InvitationStatus = (typeof invitationStatusValues)[number]

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

/**
 * InvitationとOrganizationを結合したエンティティ。
 * 招待詳細取得など、organization情報を含めて返す場合に使用する。
 */
export type InvitationWithOrganization = Invitation & {
  organization: Pick<Organization, 'id' | 'name'>
}

/**
 * Invitationと招待メール配信状態を結合したエンティティ。
 * 組織の招待一覧など、配信状態のみを公開する場合に使用する。
 * 配信レコードが存在しない招待は `emailDelivery` が `null` になる。
 */
export type InvitationWithEmailDeliveryStatus = Invitation & {
  emailDelivery: { status: InvitationEmailDeliveryStatus } | null
}
