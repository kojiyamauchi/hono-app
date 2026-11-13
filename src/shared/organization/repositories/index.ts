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
      const lockedOwners = await tx.$queryRaw<{ id: number }[]>`
        SELECT id
        FROM "User"
        WHERE id = ${ownerUserId}
        FOR UPDATE
      `
      if (lockedOwners.length === 0) {
        throw new Error('組織の作成者が見つかりません')
      }

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
   * 指定ユーザーが所属する組織を、ID昇順でオフセット式に1ページ分取得する。
   * 所属条件をDBのqueryへ適用してからoffset・limitで範囲を指定する（取得後の配列分割はしない）。
   * `take` はそのままDBへ渡す（次ページ判定のための `limit + 1` は呼び出し側が渡す）。
   */
  findPageByUserId: async (userId: number, take: number, offset: number): Promise<Organization[]> => {
    return prisma.organization.findMany({
      where: { memberships: { some: { userId } } },
      orderBy: { id: 'asc' },
      skip: offset,
      take,
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
   * 監査ログとプロジェクトは組織への外部キー（ON DELETE CASCADE）により組織の削除と同時に消えるため、明示的には削除しない。
   * 対象が存在しない場合はfalseを返す。
   *
   * ロール変更・所有権移譲・招待受諾と同じ向きでロックするため、関連行を削除する前にOrganization行を `FOR UPDATE` で確保する。
   * これにより、ロール変更（`FOR NO KEY UPDATE`）や招待受諾・招待登録（`FOR KEY SHARE`）と直列化され、
   * 削除側が子行を先に消してから親行を待つ逆順のロックによるデッドロックを避ける。
   */
  deleteById: async (id: number): Promise<boolean> => {
    return prisma.$transaction(async (tx) => {
      const lockedOrganizations = await tx.$queryRaw<{ id: number }[]>`
        SELECT id
        FROM "Organization"
        WHERE id = ${id}
        FOR UPDATE
      `
      if (lockedOrganizations.length === 0) {
        return false
      }

      await tx.invitation.deleteMany({ where: { organizationId: id } })
      await tx.membership.deleteMany({ where: { organizationId: id } })
      await tx.organization.delete({ where: { id } })
      return true
    })
  },
}
