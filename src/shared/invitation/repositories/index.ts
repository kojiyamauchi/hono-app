import { prisma } from '@/libs/prisma'
import type { Invitation, InvitationStatus } from '@/shared/invitation/entities'
import type { Membership, Role } from '@/shared/membership/entities'
import { isPrismaUniqueConstraintError } from '@/utils/prisma'

/**
 * Invitationのデータアクセスを提供するリポジトリ。
 */
export const invitationRepository = {
  /**
   * 招待を新規作成する。PENDING重複（部分ユニーク制約違反）の場合はnullを返す。
   */
  create: async (organizationId: number, email: string, role: Role, token: string, expiresAt: Date): Promise<Invitation | null> => {
    try {
      return await prisma.invitation.create({ data: { organizationId, email, role, token, expiresAt } })
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        return null
      }
      throw error
    }
  },

  /**
   * 組織IDとメールアドレスでPENDINGの招待を1件取得する。存在しない場合はnullを返す。
   */
  findPendingByOrgAndEmail: async (organizationId: number, email: string): Promise<Invitation | null> => {
    return prisma.invitation.findFirst({ where: { organizationId, email, status: 'PENDING' } })
  },

  /**
   * 組織IDに紐づく招待一覧を取得する。ステータスを指定しない場合はPENDINGのみ返す。
   */
  findAllByOrganization: async (organizationId: number, status: InvitationStatus = 'PENDING'): Promise<Invitation[]> => {
    return prisma.invitation.findMany({ where: { organizationId, status }, orderBy: { createdAt: 'desc' } })
  },

  /**
   * IDで招待を1件取得する。存在しない場合はnullを返す。
   */
  findById: async (id: number): Promise<Invitation | null> => {
    return prisma.invitation.findUnique({ where: { id } })
  },

  /**
   * PENDING状態の招待をキャンセル済みに更新する（条件付き更新）。
   * 対象が存在しないかPENDING以外の場合はfalseを返す。
   */
  cancel: async (id: number): Promise<boolean> => {
    const result = await prisma.invitation.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'CANCELED' } })
    return result.count > 0
  },

  /**
   * トークンで招待を1件取得する。存在しない場合はnullを返す。
   */
  findByToken: async (token: string): Promise<Invitation | null> => {
    return prisma.invitation.findUnique({ where: { token } })
  },

  /**
   * PENDING状態の招待を期限切れ（EXPIRED）に更新する（条件付き更新）。
   * PENDING以外の場合は更新しない（遅延失効用）。
   */
  markExpired: async (id: number): Promise<void> => {
    await prisma.invitation.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'EXPIRED' } })
  },

  /**
   * 招待を受諾し、メンバーシップを作成する（トランザクション）。
   * 招待を PENDING → ACCEPTED に条件付き更新し、membership を作成する。
   * 更新数が0（競合）またはmembership一意制約違反の場合はnullを返す。
   *
   * 一意制約違反（既メンバーとの競合）はトランザクション内で握りつぶさずthrowさせ、
   * 招待のACCEPTED更新ごとrollbackする。これにより「招待だけACCEPTEDでmembershipが無い」
   * 不整合状態を防ぐ。P2002はトランザクションの外側でnullに変換する。
   */
  accept: async (invitationId: number, organizationId: number, userId: number, role: Role): Promise<Membership | null> => {
    try {
      return await prisma.$transaction(async (tx) => {
        const result = await tx.invitation.updateMany({
          where: { id: invitationId, status: 'PENDING' },
          data: { status: 'ACCEPTED' },
        })
        if (result.count === 0) {
          return null
        }
        return await tx.membership.create({ data: { userId, organizationId, role } })
      })
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        return null
      }
      throw error
    }
  },
}
