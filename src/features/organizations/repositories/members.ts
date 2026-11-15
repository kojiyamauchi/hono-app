import { prisma } from '@/libs/prisma'
import type { Membership, Role } from '@/shared/membership/entities'

import type { LockedIdRow } from './common'

/** 組織脱退repositoryの処理結果。 */
export const leaveOrganizationResults = {
  left: 'LEFT',
  owner: 'OWNER',
  notMember: 'NOT_MEMBER',
  conflict: 'CONFLICT',
} as const

export type LeaveOrganizationResult = (typeof leaveOrganizationResults)[keyof typeof leaveOrganizationResults]

const LEAVE_MAX_ATTEMPTS = 2

/** メンバーロール変更repositoryの処理結果の種別。 */
export const memberRoleChangeResults = {
  changed: 'CHANGED',
  unchanged: 'UNCHANGED',
  organizationNotFound: 'ORGANIZATION_NOT_FOUND',
  targetNotFound: 'TARGET_NOT_FOUND',
  rejected: 'REJECTED',
  conflict: 'CONFLICT',
} as const

/**
 * メンバーロール変更repositoryの処理結果。
 * `rejected` は認可コールバックが返した拒否値をそのまま運ぶ（repositoryはHTTPエラーを知らない）。
 */
export type MemberRoleChangeResult<TRejection> =
  | { status: typeof memberRoleChangeResults.changed; membership: Membership }
  | { status: typeof memberRoleChangeResults.unchanged; membership: Membership }
  | { status: typeof memberRoleChangeResults.organizationNotFound }
  | { status: typeof memberRoleChangeResults.targetNotFound }
  | { status: typeof memberRoleChangeResults.rejected; rejection: TRejection }
  | { status: typeof memberRoleChangeResults.conflict }

/** メンバーロール変更の入力。 */
export type ChangeMemberRoleInput = {
  organizationId: number
  /** 変更対象のメンバーシップID。 */
  targetMembershipId: number
  /** 操作者（認証済みユーザー）のユーザーID。 */
  actorUserId: number
  newRole: Role
}

/** ロック後に確定した操作者と対象のロール。認可コールバックはこの値だけで判定する。 */
export type LockedRoleChangeState = {
  operatorRole: Role
  targetRole: Role
}

/**
 * ロック後の状態で認可を判定する同期コールバック。許可なら `null`、拒否なら拒否値を返す。
 * ロック中に待たせないため、DBアクセスや非同期処理は行わない。
 */
export type AuthorizeRoleChange<TRejection> = (state: LockedRoleChangeState) => TRejection | null

/**
 * メンバー削除の認可コールバックが受け取る、ロック後に確定した操作者と対象のロール。
 * 対象が存在しない場合の `targetRole` は `null`（操作者の権限判定を対象の有無より先に行うため、コールバックへ渡す）。
 */
export type LockedMemberRemovalState = {
  operatorRole: Role
  targetRole: Role | null
}

/**
 * メンバー削除の認可を、ロック後の状態で判定する同期コールバック。許可なら `null`、拒否なら拒否値を返す。
 * 対象が存在しない（`targetRole` が `null`）場合は、操作者の権限だけを判定して `null` を返してよい。
 * ロック中に待たせないため、DBアクセスや非同期処理は行わない。
 */
export type AuthorizeMemberRemoval<TRejection> = (state: LockedMemberRemovalState) => TRejection | null

type LockedRoleChangeMembershipRow = {
  id: number
  userId: number
  organizationId: number
  role: Role
  createdAt: Date
}

/** 条件付き更新が想定外に0件だったときにtransaction全体をrollbackさせる内部エラー。 */
class MemberRoleChangeConflictError extends Error {}

/** ロック済みの行を、指定ロールのMembershipへ変換する。 */
const toRoleChangeMembership = (row: LockedRoleChangeMembershipRow, role: Role): Membership => ({
  id: row.id,
  userId: row.userId,
  organizationId: row.organizationId,
  role,
  createdAt: row.createdAt,
})

/** メンバー削除repositoryの処理結果の種別。 */
export const memberRemovalResults = {
  removed: 'REMOVED',
  organizationNotFound: 'ORGANIZATION_NOT_FOUND',
  targetNotFound: 'TARGET_NOT_FOUND',
  rejected: 'REJECTED',
} as const

/**
 * メンバー削除repositoryの処理結果。
 * `rejected` は認可コールバックが返した拒否値をそのまま運ぶ（repositoryはHTTPエラーを知らない）。
 */
export type MemberRemovalResult<TRejection> =
  | { status: typeof memberRemovalResults.removed }
  | { status: typeof memberRemovalResults.organizationNotFound }
  | { status: typeof memberRemovalResults.targetNotFound }
  | { status: typeof memberRemovalResults.rejected; rejection: TRejection }

/** メンバー削除の入力。 */
export type RemoveMemberInput = {
  organizationId: number
  /** 削除対象のメンバーシップID。 */
  targetMembershipId: number
  /** 操作者（認証済みユーザー）のユーザーID。 */
  actorUserId: number
}

/**
 * organizations feature固有のメンバー操作（ロール変更・削除・脱退）のデータアクセスを提供するリポジトリ。
 * 各メソッドのtransaction・ロック・認可コールバックは独立している。
 */
export const membersRepository = {
  /**
   * Organization行、Membership行の順でロックし、ロール更新と監査ログの追加を同一transactionで確定する。
   *
   * ロック順は所有権移譲・組織削除と同じ方向（Organization → Membership）に揃える。
   * Organizationは `FOR NO KEY UPDATE` で確保し、所有権移譲の `FOR UPDATE` と直列化しつつ、
   * 監査ログのINSERT時の外部キー検査（`FOR KEY SHARE`）や招待受諾とは競合させない。
   * User行はロックしない。
   * 認可は呼び出し側のミドルウェアの値ではなく、ロック後に読み直したロールで `authorize` が判定する。
   */
  changeRole: async <TRejection>(input: ChangeMemberRoleInput, authorize: AuthorizeRoleChange<TRejection>): Promise<MemberRoleChangeResult<TRejection>> => {
    const { organizationId, targetMembershipId, actorUserId, newRole } = input

    try {
      return await prisma.$transaction(async (tx): Promise<MemberRoleChangeResult<TRejection>> => {
        const lockedOrganizations = await tx.$queryRaw<LockedIdRow[]>`
          SELECT id
          FROM "Organization"
          WHERE id = ${organizationId}
          FOR NO KEY UPDATE
        `
        if (lockedOrganizations.length === 0) {
          return { status: memberRoleChangeResults.organizationNotFound }
        }

        // 組織で絞り込み、別組織のMembership行をロック対象に含めない。id昇順で取得して他のロック取得と順序を揃える。
        const lockedMemberships = await tx.$queryRaw<LockedRoleChangeMembershipRow[]>`
          SELECT id, "userId", "organizationId", role::text AS role, "createdAt"
          FROM "Membership"
          WHERE "organizationId" = ${organizationId} AND ("userId" = ${actorUserId} OR id = ${targetMembershipId})
          ORDER BY id ASC
          FOR UPDATE
        `
        const operator = lockedMemberships.find((membership) => membership.userId === actorUserId)
        if (!operator) {
          return { status: memberRoleChangeResults.organizationNotFound }
        }
        const target = lockedMemberships.find((membership) => membership.id === targetMembershipId)
        if (!target) {
          return { status: memberRoleChangeResults.targetNotFound }
        }

        const rejection = authorize({ operatorRole: operator.role, targetRole: target.role })
        if (rejection !== null) {
          return { status: memberRoleChangeResults.rejected, rejection }
        }

        // 同一ロールの指定は許可されるが、実変更ではないため更新も記録も行わない。
        if (target.role === newRole) {
          return { status: memberRoleChangeResults.unchanged, membership: toRoleChangeMembership(target, target.role) }
        }

        const updated = await tx.membership.updateMany({
          where: { id: target.id, organizationId, role: target.role },
          data: { role: newRole },
        })
        if (updated.count !== 1) {
          throw new MemberRoleChangeConflictError()
        }

        // INSERTに失敗した場合はそのままthrowし、上のロール更新もrollbackする。
        await tx.auditLog.create({
          data: {
            organizationId,
            action: 'MEMBER_ROLE_CHANGED',
            actorUserId,
            targetUserId: target.userId,
            targetMembershipId: target.id,
            previousRole: target.role,
            newRole,
          },
        })

        return { status: memberRoleChangeResults.changed, membership: toRoleChangeMembership(target, newRole) }
      })
    } catch (error) {
      if (error instanceof MemberRoleChangeConflictError) {
        return { status: memberRoleChangeResults.conflict }
      }
      throw error
    }
  },

  /**
   * Organization行、Membership行の順でロックし、メンバー削除と監査ログの追加を同一transactionで確定する。
   *
   * ロック順・ロック強度はロール変更（`changeRole`）と同じにし、ロール変更・所有権移譲・自主脱退と直列化する。
   * 認可は呼び出し側のミドルウェアの値ではなく、ロック後に読み直したロールで `authorize` が判定する。
   * 判定順は、組織／操作者の所属なし → 認可コールバック（対象なしでも操作者がMEMBERなら拒否）
   * → 対象なし（別組織を含む） → 削除0件（対象なしとして扱う）。
   * 操作者がMEMBERの場合に対象の有無で結果が変わらないよう、操作者の認可は対象の存在確認より先に行う。
   */
  remove: async <TRejection>(input: RemoveMemberInput, authorize: AuthorizeMemberRemoval<TRejection>): Promise<MemberRemovalResult<TRejection>> => {
    const { organizationId, targetMembershipId, actorUserId } = input

    return prisma.$transaction(async (tx): Promise<MemberRemovalResult<TRejection>> => {
      const lockedOrganizations = await tx.$queryRaw<LockedIdRow[]>`
        SELECT id
        FROM "Organization"
        WHERE id = ${organizationId}
        FOR NO KEY UPDATE
      `
      if (lockedOrganizations.length === 0) {
        return { status: memberRemovalResults.organizationNotFound }
      }

      // 組織で絞り込み、別組織のMembership行をロック対象に含めない。id昇順で取得して他のロック取得と順序を揃える。
      const lockedMemberships = await tx.$queryRaw<LockedRoleChangeMembershipRow[]>`
        SELECT id, "userId", "organizationId", role::text AS role, "createdAt"
        FROM "Membership"
        WHERE "organizationId" = ${organizationId} AND ("userId" = ${actorUserId} OR id = ${targetMembershipId})
        ORDER BY id ASC
        FOR UPDATE
      `
      const operator = lockedMemberships.find((membership) => membership.userId === actorUserId)
      if (!operator) {
        return { status: memberRemovalResults.organizationNotFound }
      }
      const target = lockedMemberships.find((membership) => membership.id === targetMembershipId)

      // 対象がなくても、操作者がMEMBERなら対象の有無より先に403とする。
      const rejection = authorize({ operatorRole: operator.role, targetRole: target ? target.role : null })
      if (rejection !== null) {
        return { status: memberRemovalResults.rejected, rejection }
      }
      if (!target) {
        return { status: memberRemovalResults.targetNotFound }
      }

      // 判定に使ったロックで確認済みのロールを条件に含め、削除0件は対象なしとして扱う。
      const deleted = await tx.membership.deleteMany({
        where: { id: target.id, organizationId, role: target.role },
      })
      if (deleted.count !== 1) {
        return { status: memberRemovalResults.targetNotFound }
      }

      // 対象がOWNERの場合は認可で拒否済みのため、ここでのロールはADMINまたはMEMBERのみ。
      // INSERTに失敗した場合はそのままthrowし、上の削除もrollbackする。
      await tx.auditLog.create({
        data: {
          organizationId,
          action: 'MEMBER_REMOVED',
          actorUserId,
          targetUserId: target.userId,
          targetMembershipId: target.id,
          previousRole: target.role,
          newRole: null,
        },
      })

      return { status: memberRemovalResults.removed }
    })
  },

  /**
   * 認証ユーザー自身のOWNER以外のメンバーシップを条件付きで削除する。
   * 削除直前のロール変更で0件になった場合は最新状態を確認し、脱退可能なら再試行する。
   */
  leave: async (organizationId: number, userId: number): Promise<LeaveOrganizationResult> => {
    for (let attempt = 0; attempt < LEAVE_MAX_ATTEMPTS; attempt += 1) {
      const deleted = await prisma.membership.deleteMany({
        where: { organizationId, userId, role: { not: 'OWNER' } },
      })
      if (deleted.count === 1) {
        return leaveOrganizationResults.left
      }

      const latestMembership = await prisma.membership.findUnique({
        where: { userId_organizationId: { userId, organizationId } },
        select: { role: true },
      })
      if (!latestMembership) {
        return leaveOrganizationResults.notMember
      }
      if (latestMembership.role === 'OWNER') {
        return leaveOrganizationResults.owner
      }
    }

    return leaveOrganizationResults.conflict
  },
}
