/**
 * 組織内でのユーザーの役割の値一覧。
 * Role型・DTOのZod schema（`z.enum`）双方の正本として使い、列挙値の二重管理を防ぐ。
 */
export const roleValues = ['OWNER', 'ADMIN', 'MEMBER'] as const

/**
 * 組織内でのユーザーの役割。
 */
export type Role = (typeof roleValues)[number]

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
