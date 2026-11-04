import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/libs/prisma'
import type { Membership, Role } from '@/shared/membership/entities'
import { isPrismaNotFoundError, isPrismaUniqueConstraintError } from '@/utils/prisma'

/** メンバー一覧のカーソル式ページ取得の境界値（この行より後ろを取得する）。 */
export type MembershipPageBoundary = { createdAt: Date; id: number }

/** $queryRaw が返すMembershipの行。role はDB側のenumで値域が保証される。 */
type MembershipRow = { id: number; userId: number; organizationId: number; role: Role; createdAt: Date }

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
   * 組織IDに紐づくメンバーシップを、参加日時・IDの昇順でカーソル式に1ページ分取得する。
   * `boundary` が指定された場合は、その行より後ろ（`("createdAt", id) > (境界値)`）だけを返す。
   * `take` はそのまま `LIMIT` に使う（次ページ判定のための `limit + 1` は呼び出し側が渡す）。
   *
   * raw SQLを採用している理由:
   * Prismaのtyped APIで `OR: [{ createdAt: { gt } }, { createdAt, id: { gt } }]` と展開すると、
   * 境界条件がindexの開始位置ではなく `Filter` へ落ち、境界までの行を読み捨てる。深いページでは
   * `BitmapOr` + `Sort` へ退行する（実DBの `EXPLAIN (ANALYZE, BUFFERS)` で確認済み:
   * 50,000行の検証で `Rows Removed by Filter: 1200` / `Buffers: 1230`）。
   * 行値比較は `[organizationId, createdAt, id]` のindexの `Index Cond` へ入り、
   * ページ位置によらず `Buffers: 3〜24` で一定になる。
   */
  findPageByOrganization: async (organizationId: number, take: number, boundary: MembershipPageBoundary | null): Promise<Membership[]> => {
    const boundaryCondition = boundary ? Prisma.sql`AND ("createdAt", id) > (${boundary.createdAt}, ${boundary.id})` : Prisma.empty

    const rows = await prisma.$queryRaw<MembershipRow[]>(Prisma.sql`
      SELECT id, "userId", "organizationId", role, "createdAt"
      FROM "Membership"
      WHERE "organizationId" = ${organizationId}
      ${boundaryCondition}
      ORDER BY "createdAt" ASC, id ASC
      LIMIT ${take}
    `)

    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      organizationId: row.organizationId,
      role: row.role,
      createdAt: row.createdAt,
    }))
  },

  /**
   * IDでメンバーシップを1件取得する。存在しない場合はnullを返す。
   */
  findById: async (id: number): Promise<Membership | null> => {
    return prisma.membership.findUnique({ where: { id } })
  },

  /**
   * メンバーシップを新規作成する。一意制約違反（同一ユーザーの重複追加競合）の場合はnullを返す。
   */
  create: async (userId: number, organizationId: number, role: Role): Promise<Membership | null> => {
    try {
      return await prisma.membership.create({ data: { userId, organizationId, role } })
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        return null
      }
      throw error
    }
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
