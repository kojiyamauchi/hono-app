import type { InvitationDetailDtoType, InvitationDtoType, InvitationListItemDtoType } from '@/shared/invitation/dtos'
import type { Invitation, InvitationWithEmailDeliveryStatus } from '@/shared/invitation/entities'
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
 * 配信状態付きInvitationエンティティを招待一覧用DTOへ変換する。
 * 既存の `toInvitationResponse` の項目に、配信状態 `emailDeliveryStatus` のみを追加する。
 * 配信レコードがない場合は `null`。配信レコードのその他の項目は公開しない。
 */
export const toInvitationListItemResponse = (invitation: InvitationWithEmailDeliveryStatus): InvitationListItemDtoType => {
  return {
    ...toInvitationResponse(invitation),
    emailDeliveryStatus: invitation.emailDelivery?.status ?? null,
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
