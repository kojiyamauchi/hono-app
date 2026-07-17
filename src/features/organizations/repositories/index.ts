import { prisma } from '@/libs/prisma'
import type { Role } from '@/shared/membership/entities'

/** 所有権移譲repositoryの処理結果。 */
export const ownershipTransferResults = {
  transferred: 'TRANSFERRED',
  targetNotFound: 'TARGET_NOT_FOUND',
  selfTransfer: 'SELF_TRANSFER',
  conflict: 'CONFLICT',
} as const

export type OwnershipTransferResult = (typeof ownershipTransferResults)[keyof typeof ownershipTransferResults]

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
