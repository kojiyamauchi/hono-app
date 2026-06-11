import { prisma } from '@/libs/prisma'
import type { Invitation, InvitationStatus } from '@/shared/invitation/entities'
import type { Role } from '@/shared/membership/entities'
import { isPrismaNotFoundError } from '@/utils/prisma'

/**
 * Invitationのデータアクセスを提供するリポジトリ。
 */
export const invitationRepository = {
  /**
   * 招待を新規作成する。
   */
  create: async (organizationId: number, email: string, role: Role, token: string, expiresAt: Date): Promise<Invitation> => {
    return prisma.invitation.create({ data: { organizationId, email, role, token, expiresAt } })
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
   * 招待をキャンセル済みに更新する（物理削除ではなくステータス変更）。存在しない場合はnullを返す。
   */
  cancel: async (id: number): Promise<Invitation | null> => {
    try {
      return await prisma.invitation.update({ where: { id }, data: { status: 'CANCELED' } })
    } catch (error) {
      if (isPrismaNotFoundError(error)) {
        return null
      }
      throw error
    }
  },
}
