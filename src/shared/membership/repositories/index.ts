import { prisma } from '@/libs/prisma'
import type { Membership } from '@/shared/membership/entities'

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
}
