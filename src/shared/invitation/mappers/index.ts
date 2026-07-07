import type { InvitationDetailDtoType, InvitationDtoType } from '@/shared/invitation/dtos'
import type { Invitation } from '@/shared/invitation/entities'
import type { Organization } from '@/shared/organization/entities'

/**
 * InvitationエンティティをAPIレスポンス用のInvitation DTOへ変換する。
 * DBの `token` フィールドを `invitationToken` として公開する。
 * 日時はJSONレスポンス形式に合わせてISO datetime文字列へ変換する。
 */
export const toInvitationResponse = (invitation: Invitation): InvitationDtoType => {
  return {
    id: invitation.id,
    organizationId: invitation.organizationId,
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    invitationToken: invitation.token,
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
  }
}

/**
 * Invitationエンティティと組織情報をInvitation詳細DTOへ変換する。
 * トークンは含めず、organizationの id・name をネストして返す。
 * 実効statusはservice層で算出済みのものをinvitationに反映して渡すこと。
 * 日時はJSONレスポンス形式に合わせてISO datetime文字列へ変換する。
 */
export const toInvitationDetailResponse = (invitation: Invitation, organization: Pick<Organization, 'id' | 'name'>): InvitationDetailDtoType => {
  return {
    id: invitation.id,
    organization: {
      id: organization.id,
      name: organization.name,
    },
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
  }
}
