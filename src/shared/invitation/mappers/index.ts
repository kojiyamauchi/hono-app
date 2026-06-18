import type { InvitationDetailResponse, InvitationResponse } from '@/shared/invitation/dtos'
import type { Invitation } from '@/shared/invitation/entities'
import type { Organization } from '@/shared/organization/entities'

/**
 * InvitationエンティティをAPIレスポンス用のInvitationResponseへ変換する。
 * DBの `token` フィールドを `invitationToken` として公開する。
 */
export const toInvitationResponse = (invitation: Invitation): InvitationResponse => {
  return {
    id: invitation.id,
    organizationId: invitation.organizationId,
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    invitationToken: invitation.token,
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
  }
}

/**
 * Invitationエンティティと組織情報をInvitationDetailResponseへ変換する。
 * トークンは含めず、organizationの id・name をネストして返す。
 * 実効statusはservice層で算出済みのものをinvitationに反映して渡すこと。
 */
export const toInvitationDetailResponse = (invitation: Invitation, organization: Pick<Organization, 'id' | 'name'>): InvitationDetailResponse => {
  return {
    id: invitation.id,
    organization: {
      id: organization.id,
      name: organization.name,
    },
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
  }
}
