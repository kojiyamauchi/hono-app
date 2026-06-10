import { prisma } from '@/libs/prisma'
import type { Membership, Role } from '@/shared/membership/entities'
import { isPrismaNotFoundError } from '@/utils/prisma'

/**
 * Membershipのデータアクセスを提供するリポジトリ。
 */
export const membershipRepository = {
  /**
   * ユーザーと組織の組み合わせでメンバーシップを取得する。
   * 所属していない場合はnullを返す。認可（メンバー判定・ロール取得）に用いる。
   */
  findByUserAndOrganization: async (userId: number, organizationId: number): Promise<Membership | null> => {
    return prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
    })
  },

  /**
   * 組織IDに紐づくメンバーシップ一覧を取得する。参加日時の昇順で返す。
   */
  findAllByOrganization: async (organizationId: number): Promise<Membership[]> => {
    return prisma.membership.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    })
  },

  /**
   * IDでメンバーシップを1件取得する。存在しない場合はnullを返す。
   */
  findById: async (id: number): Promise<Membership | null> => {
    return prisma.membership.findUnique({ where: { id } })
  },

  /**
   * メンバーシップを新規作成する。
   */
  create: async (userId: number, organizationId: number, role: Role): Promise<Membership> => {
    return prisma.membership.create({ data: { userId, organizationId, role } })
  },

  /**
   * IDで指定したメンバーシップのロールを更新する。存在しない場合はnullを返す。
   */
  updateRole: async (id: number, role: Role): Promise<Membership | null> => {
    try {
      return await prisma.membership.update({ where: { id }, data: { role } })
    } catch (error) {
      if (isPrismaNotFoundError(error)) {
        return null
      }
      throw error
    }
  },

  /**
   * IDで指定したメンバーシップを削除する。存在しない場合はfalseを返す。
   */
  deleteById: async (id: number): Promise<boolean> => {
    try {
      await prisma.membership.delete({ where: { id } })
      return true
    } catch (error) {
      if (isPrismaNotFoundError(error)) {
        return false
      }
      throw error
    }
  },
}
