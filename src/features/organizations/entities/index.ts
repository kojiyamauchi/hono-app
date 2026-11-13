import type { Role } from '@/shared/membership/entities'

import type { ProjectSnapshot } from './projects'

/**
 * メンバー操作の監査ログのイベント種別。
 */
export const memberAuditActionValues = ['MEMBER_ROLE_CHANGED', 'OWNERSHIP_TRANSFERRED', 'MEMBER_REMOVED'] as const

/**
 * プロジェクト操作の監査ログのイベント種別。
 */
export const projectAuditActionValues = ['PROJECT_CREATED', 'PROJECT_UPDATED', 'PROJECT_DELETED'] as const

/**
 * 監査ログに記録するイベント種別の値一覧。
 * AuditAction型・DTOのZod schema・読み取り境界の検証の正本として使い、列挙値の二重管理を防ぐ。
 * Prismaの `AuditAction` enumと同じ値を保つこと。
 */
export const auditActionValues = [...memberAuditActionValues, ...projectAuditActionValues] as const

/**
 * 監査ログに記録するイベント種別。
 */
export type AuditAction = (typeof auditActionValues)[number]

/** すべてのイベントに共通する監査ログの項目。 */
type AuditLogBase = {
  id: number
  organizationId: number
  actorUserId: number
  createdAt: Date
}

/** メンバー操作イベントに共通する項目。プロジェクト向けの項目は持たない。 */
type MemberAuditLogBase = AuditLogBase & {
  targetUserId: number
  targetMembershipId: number
  previousRole: Role
}

/** プロジェクト操作イベントに共通する項目。メンバー向けの項目は持たない。 */
type ProjectAuditLogBase = AuditLogBase & {
  /** 対象Projectの記録時点のID。外部キーではなく、Project完全削除後も残る。 */
  projectId: number
}

/** メンバーのロール変更。変更後ロールは必須。 */
export type MemberRoleChangedAuditLog = MemberAuditLogBase & {
  action: 'MEMBER_ROLE_CHANGED'
  newRole: Role
}

/** 組織の所有権移譲。変更後ロールは必須（常にOWNER）。 */
export type OwnershipTransferredAuditLog = MemberAuditLogBase & {
  action: 'OWNERSHIP_TRANSFERRED'
  newRole: Role
}

/** 管理者によるメンバー削除。変更後ロールは存在しないためnull。 */
export type MemberRemovedAuditLog = MemberAuditLogBase & {
  action: 'MEMBER_REMOVED'
  newRole: null
}

/** プロジェクト作成。変更前はなし、変更後は作成した内容。 */
export type ProjectCreatedAuditLog = ProjectAuditLogBase & {
  action: 'PROJECT_CREATED'
  projectBefore: null
  projectAfter: ProjectSnapshot
}

/** プロジェクト更新。変更前・変更後の両方があり、実変更がある。 */
export type ProjectUpdatedAuditLog = ProjectAuditLogBase & {
  action: 'PROJECT_UPDATED'
  projectBefore: ProjectSnapshot
  projectAfter: ProjectSnapshot
}

/** プロジェクト削除。変更前は削除直前の内容、変更後はなし。 */
export type ProjectDeletedAuditLog = ProjectAuditLogBase & {
  action: 'PROJECT_DELETED'
  projectBefore: ProjectSnapshot
  projectAfter: null
}

/**
 * AuditLogドメインエンティティ。`action` で区別できるunionとし、イベントごとの必須項目を型で表す。
 * 組織内の操作を記録時点の値で保存する。ユーザー・メンバーシップ・ProjectのIDは外部キーではなく記録時点の値のため、
 * 対象が削除された後も記録は残る。
 */
export type AuditLog =
  | MemberRoleChangedAuditLog
  | OwnershipTransferredAuditLog
  | MemberRemovedAuditLog
  | ProjectCreatedAuditLog
  | ProjectUpdatedAuditLog
  | ProjectDeletedAuditLog
