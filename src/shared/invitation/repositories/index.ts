import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/libs/prisma'
import type { Invitation, InvitationStatus, InvitationWithEmailDeliveryStatus, InvitationWithOrganization } from '@/shared/invitation/entities'
import { invitationEmailLimits, type InvitationEmailSnapshot } from '@/shared/invitation/entities/emailDelivery'
import type { Membership, Role } from '@/shared/membership/entities'
import type { User } from '@/shared/user/entities'
import { isPrismaUniqueConstraintError } from '@/utils/prisma'

/** `$transaction` のinteractive transactionで渡されるclient（`$queryRaw` だけを使う）。 */
type RawQueryClient = Pick<Prisma.TransactionClient, '$queryRaw'>

/**
 * 招待を更新する前に、対象のOrganization行を `FOR KEY SHARE` で確保する。
 * 組織削除はOrganization行を先に `FOR UPDATE` でロックしてから関連行を削除する。
 * 招待の更新後にMembershipの外部キー検査で親行を待つと組織削除と逆順になるため、先に親行を確保して順序を揃える。
 * 組織がすでに削除されていれば `false` を返し、呼び出し側は既存の競合結果（null）へ変換する。
 */
const lockOrganizationForShare = async (tx: RawQueryClient, organizationId: number): Promise<boolean> => {
  const lockedOrganizations = await tx.$queryRaw<{ id: number }[]>`
    SELECT id
    FROM "Organization"
    WHERE id = ${organizationId}
    FOR KEY SHARE
  `
  return lockedOrganizations.length > 0
}

/**
 * Invitationのデータアクセスを提供するリポジトリ。
 */
export const invitationRepository = {
  /**
   * 招待を新規作成する。PENDING重複（部分ユニーク制約違反）の場合はnullを返す。
   */
  create: async (
    organizationId: number,
    email: string,
    role: Role,
    token: string,
    expiresAt: Date,
    delivery?: InvitationEmailSnapshot,
  ): Promise<Invitation | null> => {
    const data = { organizationId, email, role, token, expiresAt }
    if (delivery) {
      return prisma.$transaction(async (tx) => {
        // 招待側の一意制約違反だけを競合扱いにし、配信待ちの書き込み失敗はrollbackする。
        const [created] = await tx.invitation.createManyAndReturn({
          data,
          skipDuplicates: true,
          include: { organization: { select: { name: true } } },
        })
        if (!created) return null

        const { organization, ...invitation } = created
        await tx.invitationEmailDelivery.create({
          data: {
            ...delivery,
            invitationId: invitation.id,
            organizationName: organization.name,
            deadline: new Date(Math.min(expiresAt.getTime(), invitation.createdAt.getTime() + invitationEmailLimits.maxAgeMs)),
          },
        })
        return invitation
      })
    }

    try {
      return await prisma.invitation.create({ data })
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
   * 招待メール配信状態（statusのみ）を1クエリで併せて取得する。配信レコードがない招待は `emailDelivery` が `null`。
   */
  findAllByOrganization: async (organizationId: number, status: InvitationStatus = 'PENDING'): Promise<InvitationWithEmailDeliveryStatus[]> => {
    return prisma.invitation.findMany({
      where: { organizationId, status },
      orderBy: { createdAt: 'desc' },
      include: { emailDelivery: { select: { status: true } } },
    })
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
   * トークンで招待を取得し、紐づくOrganizationも同時に取得する。
   * 招待詳細取得など、organization情報が必要な場合に使用する。
   * 存在しない場合はnullを返す。
   */
  findByTokenWithOrganization: async (token: string): Promise<InvitationWithOrganization | null> => {
    const result = await prisma.invitation.findUnique({
      where: { token },
      include: { organization: { select: { id: true, name: true } } },
    })
    if (!result) return null
    const { organization, ...invitation } = result
    return { ...invitation, organization }
  },

  /**
   * PENDING状態の招待を期限切れ（EXPIRED）に更新する（条件付き更新）。
   * PENDING以外の場合は更新しない（遅延失効用）。
   */
  markExpired: async (id: number): Promise<void> => {
    await prisma.invitation.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'EXPIRED' } })
  },

  /**
   * PENDING状態の招待を辞退済み（DECLINED）に更新する（条件付き更新）。
   * 対象が存在しないかPENDING以外の場合はfalseを返す。
   */
  decline: async (id: number): Promise<boolean> => {
    const result = await prisma.invitation.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'DECLINED' } })
    return result.count > 0
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
        if (!(await lockOrganizationForShare(tx, organizationId))) {
          return null
        }
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

  /**
   * 招待経由でユーザーを作成し、メンバーシップ作成と招待の受諾を同時に行う（トランザクション）。
   * 招待の条件付き更新に失敗した場合、またはユーザー/メンバーシップの一意制約違反の場合はnullを返す。
   */
  signup: async (invitationId: number, organizationId: number, email: string, name: string, password: string, role: Role): Promise<User | null> => {
    try {
      return await prisma.$transaction(async (tx) => {
        if (!(await lockOrganizationForShare(tx, organizationId))) {
          return null
        }
        const result = await tx.invitation.updateMany({
          where: { id: invitationId, status: 'PENDING' },
          data: { status: 'ACCEPTED' },
        })
        if (result.count === 0) {
          return null
        }

        const user = await tx.user.create({ data: { name, email, password } })
        await tx.membership.create({ data: { userId: user.id, organizationId, role } })
        return user
      })
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        return null
      }
      throw error
    }
  },
}
