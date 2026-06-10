import type { Role } from '@/shared/membership/entities'

/**
 * APIレスポンス用のMembership表現。
 */
export type MemberResponse = {
  id: number
  userId: number
  organizationId: number
  role: Role
  createdAt: Date
}
