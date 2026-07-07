import type { MemberDtoType } from '@/shared/membership/dtos'
import type { Membership } from '@/shared/membership/entities'

/**
 * MembershipエンティティをAPIレスポンス用のMember DTOへ変換する。
 * 日時はJSONレスポンス形式に合わせてISO datetime文字列へ変換する。
 */
export const toMemberResponse = (membership: Membership): MemberDtoType => {
  return {
    id: membership.id,
    userId: membership.userId,
    organizationId: membership.organizationId,
    role: membership.role,
    createdAt: membership.createdAt.toISOString(),
  }
}
