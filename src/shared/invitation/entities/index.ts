import type { Role } from '@/shared/membership/entities'
import type { Organization } from '@/shared/organization/entities'

/**
 * 招待ステータス。
 */
export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'CANCELED' | 'DECLINED'

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
