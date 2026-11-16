import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/libs/prisma'
import { type Role, roleValues } from '@/shared/membership/entities'

import type { AuditLog, ProjectSnapshot } from '../entities/auditLogs'

/** 監査ログ一覧のカーソル式ページ取得の境界値（この行より後ろ、つまりより古い行を取得する）。 */
export type AuditLogPageBoundary = { createdAt: Date; id: number }

/**
 * organizations feature固有の監査ログデータアクセスを提供するリポジトリ。
 */
export const auditLogsRepository = {
  /**
   * 組織IDに紐づく監査ログを、記録日時・IDの降順（新しい順）でカーソル式に1ページ分取得する。
   * `boundary` が指定された場合は、その行より後ろ（`("createdAt", id) < (境界値)`）だけを返す。
   * `take` はそのまま `LIMIT` に使う（次ページ判定のための `limit + 1` は呼び出し側が渡す）。
   *
   * メンバー一覧と同じ理由でraw SQLを採用している。行値比較にすると境界条件が
   * `[organizationId, createdAt, id]` のindexの `Index Cond` へ入り、深いページでも読み捨てが発生しない。
   * 降順の並びはindexの逆方向スキャンで満たす。境界行そのものが存在するかには依存しない。
   */
  findPage: async (organizationId: number, take: number, boundary: AuditLogPageBoundary | null): Promise<AuditLog[]> => {
    const boundaryCondition = boundary ? Prisma.sql`AND ("createdAt", id) < (${boundary.createdAt}, ${boundary.id})` : Prisma.empty

    // プロジェクトやユーザーの現存を前提にしたJOINは行わず、削除後も記録を取得できるようにする。
    const rows = await prisma.$queryRaw<unknown[]>(Prisma.sql`
      SELECT id, "organizationId", action, "actorUserId", "targetUserId", "targetMembershipId", "previousRole", "newRole",
        "projectId", "projectBefore", "projectAfter",
        "projectBefore" IS NULL AS "projectBeforeIsSqlNull", "projectAfter" IS NULL AS "projectAfterIsSqlNull",
        "createdAt"
      FROM "AuditLog"
      WHERE "organizationId" = ${organizationId}
      ${boundaryCondition}
      ORDER BY "createdAt" DESC, id DESC
      LIMIT ${take}
    `)

    // 読み取り境界で全行を検証する。不正な行は読み飛ばさず例外にして、一覧リクエスト全体を失敗させる。
    return rows.map(toAuditLogEntity)
  },
}

const roleSet: ReadonlySet<unknown> = new Set(roleValues)

/** 不整合を検出したことを例外で知らせる。行の内容（名前・説明）はメッセージに含めない。 */
const invalidAuditLogRow = (reason: string): never => {
  throw new Error(`監査ログの行が不正です: ${reason}`)
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** JSONの `{ name: string, description: string | null }` を固定形状で検証する。文字数制約やtrimは行わない。 */
const parseProjectSnapshot = (value: unknown, field: string): ProjectSnapshot => {
  if (!isRecord(value)) {
    return invalidAuditLogRow(`${field}がオブジェクトではありません`)
  }
  const keys = Object.keys(value)
  if (keys.length !== 2 || !('name' in value) || !('description' in value)) {
    return invalidAuditLogRow(`${field}のキーが name と description の2つではありません`)
  }
  const { name, description } = value
  if (typeof name !== 'string') {
    return invalidAuditLogRow(`${field}.nameが文字列ではありません`)
  }
  if (description !== null && typeof description !== 'string') {
    return invalidAuditLogRow(`${field}.descriptionが文字列でもnullでもありません`)
  }
  return { name, description }
}

const requireInteger = (value: unknown, field: string): number =>
  typeof value === 'number' && Number.isInteger(value) ? value : invalidAuditLogRow(`${field}が整数ではありません`)

const requireRole = (value: unknown, field: string): Role => (roleSet.has(value) ? (value as Role) : invalidAuditLogRow(`${field}が不正なロールです`))

const requireNull = (value: unknown, field: string): null => (value === null ? null : invalidAuditLogRow(`${field}はこのイベントではnullでなければなりません`))

/**
 * 生の行を、actionで区別されるAuditLogエンティティへ変換する。
 * DBの型注釈を信用せず、未知のaction・イベントと項目の不整合・JSONの形状違反はすべて例外にする
 * （読み飛ばし・既定値による補完・別イベントへの変換は行わない）。
 */
const toAuditLogEntity = (row: unknown): AuditLog => {
  if (!isRecord(row)) {
    return invalidAuditLogRow('行がオブジェクトではありません')
  }
  if (!(row.createdAt instanceof Date)) {
    return invalidAuditLogRow('createdAtが日時ではありません')
  }
  const base = {
    id: requireInteger(row.id, 'id'),
    organizationId: requireInteger(row.organizationId, 'organizationId'),
    actorUserId: requireInteger(row.actorUserId, 'actorUserId'),
    createdAt: row.createdAt,
  }

  // JSONB列はデコードするとSQL NULLとJSON nullがどちらもJSのnullになるため、SQLの `IS NULL` 判定を補助booleanとして取得し、
  // 区別したまま検証する。補助booleanはここでの検証だけに使い、Entity・DTOへは含めない。
  const sqlNullFlags = { projectBefore: row.projectBeforeIsSqlNull, projectAfter: row.projectAfterIsSqlNull }
  for (const [field, flag] of Object.entries(sqlNullFlags)) {
    if (typeof flag !== 'boolean') {
      return invalidAuditLogRow(`${field}のSQL NULL判定が真偽値ではありません`)
    }
  }
  /** 存在しない側のスナップショット。SQL NULLだけを許可し、JSON nullは拒否する。 */
  const absentSnapshot = (field: 'projectBefore' | 'projectAfter'): null =>
    sqlNullFlags[field] === true && row[field] === null ? null : invalidAuditLogRow(`${field}はこのイベントではSQL NULLでなければなりません`)
  /** 必要な側のスナップショット。SQL NULLは拒否し、JSON null・不正な形状は固定形状検証で拒否する。 */
  const presentSnapshot = (field: 'projectBefore' | 'projectAfter'): ProjectSnapshot =>
    sqlNullFlags[field] === true ? invalidAuditLogRow(`${field}がSQL NULLです`) : parseProjectSnapshot(row[field], field)

  const parseMemberFields = (): { targetUserId: number; targetMembershipId: number; previousRole: Role } => {
    requireNull(row.projectId, 'projectId')
    absentSnapshot('projectBefore')
    absentSnapshot('projectAfter')
    return {
      targetUserId: requireInteger(row.targetUserId, 'targetUserId'),
      targetMembershipId: requireInteger(row.targetMembershipId, 'targetMembershipId'),
      previousRole: requireRole(row.previousRole, 'previousRole'),
    }
  }
  const requireNoMemberFields = (): void => {
    requireNull(row.targetUserId, 'targetUserId')
    requireNull(row.targetMembershipId, 'targetMembershipId')
    requireNull(row.previousRole, 'previousRole')
    requireNull(row.newRole, 'newRole')
  }

  switch (row.action) {
    case 'MEMBER_ROLE_CHANGED':
      return { ...base, action: 'MEMBER_ROLE_CHANGED', ...parseMemberFields(), newRole: requireRole(row.newRole, 'newRole') }
    case 'OWNERSHIP_TRANSFERRED':
      return { ...base, action: 'OWNERSHIP_TRANSFERRED', ...parseMemberFields(), newRole: requireRole(row.newRole, 'newRole') }
    case 'MEMBER_REMOVED':
      return { ...base, action: 'MEMBER_REMOVED', ...parseMemberFields(), newRole: requireNull(row.newRole, 'newRole') }
    case 'PROJECT_CREATED': {
      requireNoMemberFields()
      const projectId = requireInteger(row.projectId, 'projectId')
      return {
        ...base,
        action: 'PROJECT_CREATED',
        projectId,
        projectBefore: absentSnapshot('projectBefore'),
        projectAfter: presentSnapshot('projectAfter'),
      }
    }
    case 'PROJECT_UPDATED': {
      requireNoMemberFields()
      const projectId = requireInteger(row.projectId, 'projectId')
      const projectBefore = presentSnapshot('projectBefore')
      const projectAfter = presentSnapshot('projectAfter')
      // 更新イベントは実変更があるときだけ記録される。同値のスナップショットは不整合として扱う。
      if (projectBefore.name === projectAfter.name && projectBefore.description === projectAfter.description) {
        return invalidAuditLogRow('PROJECT_UPDATEDのbeforeとafterが同値です')
      }
      return { ...base, action: 'PROJECT_UPDATED', projectId, projectBefore, projectAfter }
    }
    case 'PROJECT_DELETED': {
      requireNoMemberFields()
      const projectId = requireInteger(row.projectId, 'projectId')
      return {
        ...base,
        action: 'PROJECT_DELETED',
        projectId,
        projectBefore: presentSnapshot('projectBefore'),
        projectAfter: absentSnapshot('projectAfter'),
      }
    }
    default:
      return invalidAuditLogRow('未知のactionです')
  }
}
