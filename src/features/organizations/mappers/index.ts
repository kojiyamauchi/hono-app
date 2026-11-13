import type { Membership, Role } from '@/shared/membership/entities'
import { toMemberResponse } from '@/shared/membership/mappers'
import type { Organization } from '@/shared/organization/entities'
import { toOrganizationResponse } from '@/shared/organization/mappers'

import type { AuditLogDtoType, AuditLogListDtoType, MemberListDtoType, OrganizationListDtoType } from '../dtos'
import type { AuditLog, MemberRemovedAuditLog, MemberRoleChangedAuditLog, OwnershipTransferredAuditLog } from '../entities'
import type { ProjectSnapshot } from '../entities/projects'
import {
  AUDIT_LOG_CURSOR_KIND,
  AUDIT_LOG_CURSOR_VERSION,
  auditLogCursorPayloadSchema,
  MEMBER_LIST_CURSOR_VERSION,
  memberListCursorPayloadSchema,
} from '../schemas'

/**
 * メンバー一覧カーソルが指す境界値（この行より後ろを取得する）。
 * `organizationId` はカーソルを発行した組織で、別組織への使い回しを検出するために含める。
 */
export type MemberListCursorBoundary = { organizationId: number; createdAt: Date; id: number }

/**
 * 境界値をメンバー一覧用の不透明なカーソル文字列へ変換する（JSONをbase64urlで包む）。
 * 署名・暗号化は行わない。デコードすれば内容を読めて改変もできる前提のため、機密情報を含めないこと。
 */
export const encodeMemberListCursor = (boundary: MemberListCursorBoundary): string => {
  const json = JSON.stringify({
    version: MEMBER_LIST_CURSOR_VERSION,
    organizationId: boundary.organizationId,
    createdAt: boundary.createdAt.toISOString(),
    id: boundary.id,
  })
  return Buffer.from(json, 'utf8').toString('base64url')
}

/**
 * メンバー一覧用のカーソル文字列を境界値へ戻す。
 * 形式・値が不正なら `null` を返し、呼び出し側で400へ変換する。
 * 対象組織の一致はservice層が認可済みのorganizationIdと突き合わせて確認する。
 */
export const decodeMemberListCursor = (raw: string): MemberListCursorBoundary | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
  } catch {
    return null
  }

  const result = memberListCursorPayloadSchema.safeParse(parsed)
  if (!result.success) {
    return null
  }

  return {
    organizationId: result.data.organizationId,
    createdAt: new Date(result.data.createdAt),
    id: result.data.id,
  }
}

/**
 * 監査ログ一覧カーソルが指す境界値（この行より後ろ、つまりより古い行を取得する）。
 * `organizationId` はカーソルを発行した組織で、別組織への使い回しを検出するために含める。
 */
export type AuditLogCursorBoundary = { organizationId: number; createdAt: Date; id: number }

/**
 * 境界値を監査ログ一覧用の不透明なカーソル文字列へ変換する（JSONをbase64urlで包む）。
 * メンバー一覧のカーソルと区別するため `kind` を含める。
 * 署名・暗号化は行わない。デコードすれば内容を読めて改変もできる前提のため、機密情報を含めないこと。
 */
export const encodeAuditLogCursor = (boundary: AuditLogCursorBoundary): string => {
  const json = JSON.stringify({
    kind: AUDIT_LOG_CURSOR_KIND,
    version: AUDIT_LOG_CURSOR_VERSION,
    organizationId: boundary.organizationId,
    createdAt: boundary.createdAt.toISOString(),
    id: boundary.id,
  })
  return Buffer.from(json, 'utf8').toString('base64url')
}

/**
 * 監査ログ一覧用のカーソル文字列を境界値へ戻す。
 * 形式・値が不正、または `kind` が一致しない（メンバー一覧など別APIのカーソル）なら `null` を返し、呼び出し側で400へ変換する。
 * 発行時と同じ正規のbase64url文字列だけを受け付ける（不正な文字の付加や `=` パディングは不正として扱う）。
 * 対象組織の一致はservice層が認可済みのorganizationIdと突き合わせて確認する。
 */
export const decodeAuditLogCursor = (raw: string): AuditLogCursorBoundary | null => {
  let parsed: unknown
  try {
    const decoded = Buffer.from(raw, 'base64url')
    // `Buffer.from(raw, 'base64url')` は不正な文字を黙って無視するため、末尾に `!` などを足した文字列も復元できてしまう。
    // 再エンコードした結果が入力と一致しなければ、発行時と異なる形式（改変されたカーソル）として不正にする。
    if (decoded.toString('base64url') !== raw) {
      return null
    }
    parsed = JSON.parse(decoded.toString('utf8'))
  } catch {
    return null
  }

  const result = auditLogCursorPayloadSchema.safeParse(parsed)
  if (!result.success) {
    return null
  }

  return {
    organizationId: result.data.organizationId,
    createdAt: new Date(result.data.createdAt),
    id: result.data.id,
  }
}

type MemberAuditLog = MemberRoleChangedAuditLog | OwnershipTransferredAuditLog | MemberRemovedAuditLog

/** 想定外のeventが追加されたときにコンパイルエラーにし、実行時には暗黙の変換をせず例外にする。 */
const assertNever = (value: never): never => {
  throw new Error(`未対応の監査ログです: ${JSON.stringify(value)}`)
}

/** メンバー操作イベント共通の対象項目をDTO形式へ変換する。 */
const toMemberTargetResponse = (auditLog: MemberAuditLog): { targetUserId: number; targetMembershipId: number; previousRole: Role } => ({
  targetUserId: auditLog.targetUserId,
  targetMembershipId: auditLog.targetMembershipId,
  previousRole: auditLog.previousRole,
})

/** プロジェクトのスナップショットを、name・descriptionの2キーだけのDTOへ変換する（空文字とnullは区別して保持する）。 */
const toProjectSnapshotResponse = (snapshot: ProjectSnapshot): { name: string; description: string | null } => ({
  name: snapshot.name,
  description: snapshot.description,
})

/**
 * 監査ログをレスポンス用DTOへ変換する。`createdAt` はISO 8601の日時文字列にする。
 */
export const toAuditLogResponse = (auditLog: AuditLog): AuditLogDtoType => {
  const common = {
    id: auditLog.id,
    organizationId: auditLog.organizationId,
    actorUserId: auditLog.actorUserId,
    createdAt: auditLog.createdAt.toISOString(),
  }

  // 既存3イベントはメンバー向け項目だけ、プロジェクトイベントはprojectId・before・afterだけを返す（互いのキーを持ち込まない）。
  // projectBefore / projectAfter は before / after へ変換し、両キーを必ず返す（存在しない側はnull）。
  switch (auditLog.action) {
    case 'MEMBER_ROLE_CHANGED':
      return { ...common, action: auditLog.action, ...toMemberTargetResponse(auditLog), newRole: auditLog.newRole }
    case 'OWNERSHIP_TRANSFERRED':
      return { ...common, action: auditLog.action, ...toMemberTargetResponse(auditLog), newRole: auditLog.newRole }
    case 'MEMBER_REMOVED':
      return { ...common, action: auditLog.action, ...toMemberTargetResponse(auditLog), newRole: null }
    case 'PROJECT_CREATED':
      return {
        ...common,
        action: auditLog.action,
        projectId: auditLog.projectId,
        before: null,
        after: toProjectSnapshotResponse(auditLog.projectAfter),
      }
    case 'PROJECT_UPDATED':
      return {
        ...common,
        action: auditLog.action,
        projectId: auditLog.projectId,
        before: toProjectSnapshotResponse(auditLog.projectBefore),
        after: toProjectSnapshotResponse(auditLog.projectAfter),
      }
    case 'PROJECT_DELETED':
      return {
        ...common,
        action: auditLog.action,
        projectId: auditLog.projectId,
        before: toProjectSnapshotResponse(auditLog.projectBefore),
        after: null,
      }
    default:
      return assertNever(auditLog)
  }
}

/**
 * 監査ログのページをカーソル式ページネーションの応答DTOへ変換する。
 * `nextCursor` が `null` なら後続のページは存在しない。
 */
export const toAuditLogListResponse = (auditLogs: AuditLog[], nextCursor: string | null): AuditLogListDtoType => {
  return {
    items: auditLogs.map(toAuditLogResponse),
    nextCursor,
  }
}

/**
 * メンバーのページをカーソル式ページネーションの応答DTOへ変換する。
 * `nextCursor` が `null` なら後続のページは存在しない。
 */
export const toMemberListResponse = (memberships: Membership[], nextCursor: string | null): MemberListDtoType => {
  return {
    items: memberships.map(toMemberResponse),
    nextCursor,
  }
}

/**
 * 組織のページをオフセット式ページネーションの応答DTOへ変換する。
 */
export const toOrganizationListResponse = (organizations: Organization[], limit: number, offset: number, hasNext: boolean): OrganizationListDtoType => {
  return {
    items: organizations.map(toOrganizationResponse),
    limit,
    offset,
    hasNext,
  }
}
