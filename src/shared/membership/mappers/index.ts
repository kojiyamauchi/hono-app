import type { MemberResponse } from '@/shared/membership/dtos'
import type { Membership } from '@/shared/membership/entities'

/**
 * MembershipエンティティをAPIレスポンス用のMemberResponseへ変換する。
 */
export const toMemberResponse = (membership: Membership): MemberResponse => {
  return {
    id: membership.id,
    userId: membership.userId,
    organizationId: membership.organizationId,
    role: membership.role,
    createdAt: membership.createdAt,
  }
}
