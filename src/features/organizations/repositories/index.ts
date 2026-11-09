import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/libs/prisma'
import type { Membership, Role } from '@/shared/membership/entities'

import type { AuditLog } from '../entities'

/** 所有権移譲repositoryの処理結果。 */
export const ownershipTransferResults = {
  transferred: 'TRANSFERRED',
  targetNotFound: 'TARGET_NOT_FOUND',
  selfTransfer: 'SELF_TRANSFER',
  conflict: 'CONFLICT',
} as const

export type OwnershipTransferResult = (typeof ownershipTransferResults)[keyof typeof ownershipTransferResults]

/** 組織脱退repositoryの処理結果。 */
export const leaveOrganizationResults = {
  left: 'LEFT',
  owner: 'OWNER',
  notMember: 'NOT_MEMBER',
  conflict: 'CONFLICT',
} as const

export type LeaveOrganizationResult = (typeof leaveOrganizationResults)[keyof typeof leaveOrganizationResults]

const LEAVE_MAX_ATTEMPTS = 2

type LockedIdRow = {
  id: number
}

type LockedMembershipRow = {
  id: number
  userId: number
  organizationId: number
  role: Role
}

/** 更新開始後の競合をtransaction全体のrollbackへ変換する内部エラー。 */
class OwnershipTransferConflictError extends Error {}

/**
 * organizations feature固有の所有権移譲データアクセスを提供するリポジトリ。
 */
export const organizationOwnershipRepository = {
  /**
   * 移譲先User行、Organization行、Membership行の順でロックし、所有権を原子的に移譲する。
   */
  transferOwnership: async (organizationId: number, currentOwnerUserId: number, targetMembershipId: number): Promise<OwnershipTransferResult> => {
    try {
      return await prisma.$transaction(async (tx) => {
        // Membershipとの結合で移譲先Userを直接特定し、最初のロック対象をUser行に固定する。
        const lockedTargetUsers = await tx.$queryRaw<LockedIdRow[]>`
          SELECT u.id
          FROM "User" AS u
          INNER JOIN "Membership" AS m ON m."userId" = u.id
          WHERE m.id = ${targetMembershipId}
          FOR UPDATE OF u
        `
        const targetUserId = lockedTargetUsers[0]?.id
        if (targetUserId === undefined) {
          return ownershipTransferResults.targetNotFound
        }

        // 同一組織への複数の移譲を直列化するため、User行の次にOrganization行をロックする。
        const lockedOrganizations = await tx.$queryRaw<LockedIdRow[]>`
          SELECT id
          FROM "Organization"
          WHERE id = ${organizationId}
          FOR UPDATE
        `
        if (lockedOrganizations.length === 0) {
          return ownershipTransferResults.conflict
        }

        // 認可と移譲先の判定にはmiddlewareの値を使わず、ロック後のMembershipを正本とする。
        const lockedMemberships = await tx.$queryRaw<LockedMembershipRow[]>`
          SELECT id, "userId", "organizationId", role::text AS role
          FROM "Membership"
          WHERE
            ("userId" = ${currentOwnerUserId} AND "organizationId" = ${organizationId})
            OR id = ${targetMembershipId}
          ORDER BY id ASC
          FOR UPDATE
        `
        const currentOwner = lockedMemberships.find((membership) => membership.userId === currentOwnerUserId && membership.organizationId === organizationId)
        if (!currentOwner || currentOwner.role !== 'OWNER') {
          return ownershipTransferResults.conflict
        }

        const target = lockedMemberships.find((membership) => membership.id === targetMembershipId)
        if (!target || target.organizationId !== organizationId) {
          return ownershipTransferResults.targetNotFound
        }
        if (target.userId === currentOwnerUserId) {
          return ownershipTransferResults.selfTransfer
        }
        if (target.userId !== targetUserId || (target.role !== 'ADMIN' && target.role !== 'MEMBER')) {
          return ownershipTransferResults.conflict
        }

        const promoted = await tx.membership.updateMany({
          where: { id: target.id, userId: targetUserId, organizationId, role: { in: ['ADMIN', 'MEMBER'] } },
          data: { role: 'OWNER' },
        })
        if (promoted.count !== 1) {
          throw new OwnershipTransferConflictError()
        }

        const demoted = await tx.membership.updateMany({
          where: { id: currentOwner.id, userId: currentOwnerUserId, organizationId, role: 'OWNER' },
          data: { role: 'ADMIN' },
        })
        if (demoted.count !== 1) {
          throw new OwnershipTransferConflictError()
        }

        // 移譲先の昇格と移譲元の降格を1回の操作として記録する。previousRoleはロック取得後に確認した移譲先のロール。
        // INSERTに失敗した場合はそのままthrowし（conflictへ変換しない）、上の両ロール更新もrollbackする。
        await tx.auditLog.create({
          data: {
            organizationId,
            action: 'OWNERSHIP_TRANSFERRED',
            actorUserId: currentOwnerUserId,
            targetUserId,
            targetMembershipId: target.id,
            previousRole: target.role,
            newRole: 'OWNER',
          },
        })

        return ownershipTransferResults.transferred
      })
    } catch (error) {
      if (error instanceof OwnershipTransferConflictError) {
        return ownershipTransferResults.conflict
      }
      throw error
    }
  },
}

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

/**
 * organizations feature固有のメンバーロール変更データアクセスを提供するリポジトリ。
 */
export const organizationMemberRoleRepository = {
  /**
   * Organization行、Membership行の順でロックし、ロール更新と監査ログの追加を同一transactionで確定する。
   *
   * ロック順は所有権移譲・組織削除と同じ方向（Organization → Membership）に揃える。
   * Organizationは `FOR NO KEY UPDATE` で確保し、所有権移譲の `FOR UPDATE` と直列化しつつ、
   * 監査ログのINSERT時の外部キー検査（`FOR KEY SHARE`）や招待受諾とは競合させない。
   * User行はロックしない。
   * 認可は呼び出し側のミドルウェアの値ではなく、ロック後に読み直したロールで `authorize` が判定する。
   */
  changeRoleWithAuditLog: async <TRejection>(
    input: ChangeMemberRoleInput,
    authorize: AuthorizeRoleChange<TRejection>,
  ): Promise<MemberRoleChangeResult<TRejection>> => {
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
}

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
 * organizations feature固有のメンバー削除データアクセスを提供するリポジトリ。
 */
export const organizationMemberRemovalRepository = {
  /**
   * Organization行、Membership行の順でロックし、メンバー削除と監査ログの追加を同一transactionで確定する。
   *
   * ロック順・ロック強度はロール変更（`changeRoleWithAuditLog`）と同じにし、ロール変更・所有権移譲・自主脱退と直列化する。
   * 認可は呼び出し側のミドルウェアの値ではなく、ロック後に読み直したロールで `authorize` が判定する。
   * 判定順は、組織／操作者の所属なし → 対象なし（別組織を含む） → 認可コールバック。
   * 操作者がMEMBERの場合に対象の有無で結果が変わらないよう、操作者の認可は対象の存在確認より先に行う。
   */
  removeWithAuditLog: async <TRejection>(input: RemoveMemberInput, authorize: AuthorizeMemberRemoval<TRejection>): Promise<MemberRemovalResult<TRejection>> => {
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
}

/** 監査ログ一覧のカーソル式ページ取得の境界値（この行より後ろ、つまりより古い行を取得する）。 */
export type AuditLogPageBoundary = { createdAt: Date; id: number }

/**
 * organizations feature固有の監査ログデータアクセスを提供するリポジトリ。
 */
export const organizationAuditLogRepository = {
  /**
   * 組織IDに紐づく監査ログを、記録日時・IDの降順（新しい順）でカーソル式に1ページ分取得する。
   * `boundary` が指定された場合は、その行より後ろ（`("createdAt", id) < (境界値)`）だけを返す。
   * `take` はそのまま `LIMIT` に使う（次ページ判定のための `limit + 1` は呼び出し側が渡す）。
   *
   * メンバー一覧と同じ理由でraw SQLを採用している。行値比較にすると境界条件が
   * `[organizationId, createdAt, id]` のindexの `Index Cond` へ入り、深いページでも読み捨てが発生しない。
   * 降順の並びはindexの逆方向スキャンで満たす。境界行そのものが存在するかには依存しない。
   */
  findPageByOrganization: async (organizationId: number, take: number, boundary: AuditLogPageBoundary | null): Promise<AuditLog[]> => {
    const boundaryCondition = boundary ? Prisma.sql`AND ("createdAt", id) < (${boundary.createdAt}, ${boundary.id})` : Prisma.empty

    const rows = await prisma.$queryRaw<AuditLog[]>(Prisma.sql`
      SELECT id, "organizationId", action, "actorUserId", "targetUserId", "targetMembershipId", "previousRole", "newRole", "createdAt"
      FROM "AuditLog"
      WHERE "organizationId" = ${organizationId}
      ${boundaryCondition}
      ORDER BY "createdAt" DESC, id DESC
      LIMIT ${take}
    `)

    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      action: row.action,
      actorUserId: row.actorUserId,
      targetUserId: row.targetUserId,
      targetMembershipId: row.targetMembershipId,
      previousRole: row.previousRole,
      newRole: row.newRole,
      createdAt: row.createdAt,
    }))
  },
}

/**
 * organizations feature固有のメンバーシップデータアクセスを提供するリポジトリ。
 */
export const organizationMembershipRepository = {
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
