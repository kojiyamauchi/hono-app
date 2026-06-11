import type { InvitationResponse } from '@/shared/invitation/dtos'
import type { Invitation } from '@/shared/invitation/entities'

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
