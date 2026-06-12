import { prisma } from '@/libs/prisma'
import type { Organization } from '@/shared/organization/entities'
import { isPrismaNotFoundError } from '@/utils/prisma'

/**
 * Organizationの更新時に変更可能な入力値。
 */
type UpdateOrganizationInput = {
  name: string
}

/**
 * Organizationのデータアクセスを提供するリポジトリ。
 * Prismaへの依存をこの層に閉じ込める。
 */
export const organizationRepository = {
  /**
   * 組織を作成し、作成者をOWNERとするメンバーシップを同時に作成する（トランザクション）。
   */
  createWithOwner: async (name: string, ownerUserId: number): Promise<Organization> => {
    return prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({ data: { name } })
      await tx.membership.create({
        data: { userId: ownerUserId, organizationId: organization.id, role: 'OWNER' },
      })
      return organization
    })
  },

  /**
   * IDで組織を1件取得する。存在しない場合はnullを返す。
   */
  findById: async (id: number): Promise<Organization | null> => {
    return prisma.organization.findUnique({ where: { id } })
  },

  /**
   * 指定ユーザーが所属する組織の一覧を取得する。
   */
  findByUserId: async (userId: number): Promise<Organization[]> => {
    return prisma.organization.findMany({
      where: { memberships: { some: { userId } } },
      orderBy: { id: 'asc' },
    })
  },

  /**
   * 組織を更新する。
   */
  update: async (id: number, input: UpdateOrganizationInput): Promise<Organization | null> => {
    try {
      return await prisma.organization.update({ where: { id }, data: input })
    } catch (error) {
      if (isPrismaNotFoundError(error)) {
        return null
      }

      throw error
    }
  },

  /**
   * 組織を削除する。関連するメンバーシップと招待も同時に削除する（トランザクション）。
   * 対象が存在しない場合はfalseを返す。
   */
  deleteById: async (id: number): Promise<boolean> => {
    try {
      await prisma.$transaction([
        prisma.invitation.deleteMany({ where: { organizationId: id } }),
        prisma.membership.deleteMany({ where: { organizationId: id } }),
        prisma.organization.delete({ where: { id } }),
      ])
      return true
    } catch (error) {
      if (isPrismaNotFoundError(error)) {
        return false
      }

      throw error
    }
  },
}
