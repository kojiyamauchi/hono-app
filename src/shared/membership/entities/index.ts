/**
 * 組織内でのユーザーの役割。
 */
export type Role = 'OWNER' | 'ADMIN' | 'MEMBER'

/**
 * Membershipドメインエンティティ。
 * UserとOrganizationの所属関係と、その役割（role）を表す。
 */
export type Membership = {
  id: number
  userId: number
  organizationId: number
  role: Role
  createdAt: Date
}
