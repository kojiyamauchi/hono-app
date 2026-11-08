import type { Role } from '@/shared/membership/entities'

/**
 * 監査ログに記録するイベント種別の値一覧。
 * AuditAction型・DTOのZod schema（`z.enum`）双方の正本として使い、列挙値の二重管理を防ぐ。
 */
export const auditActionValues = ['MEMBER_ROLE_CHANGED'] as const

/**
 * 監査ログに記録するイベント種別。
 */
export type AuditAction = (typeof auditActionValues)[number]

/**
 * AuditLogドメインエンティティ。
 * 組織内の操作を記録時点の値で保存する。ユーザーとメンバーシップのIDは外部キーではなく記録時点の値のため、
 * 対象が削除された後も記録は残る。
 */
export type AuditLog = {
  id: number
  organizationId: number
  action: AuditAction
  actorUserId: number
  targetUserId: number
  targetMembershipId: number
  previousRole: Role
  newRole: Role
  createdAt: Date
}
