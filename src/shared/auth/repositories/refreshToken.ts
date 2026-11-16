import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/libs/prisma'
import type { RefreshSession, RefreshToken } from '@/shared/auth/entities/refreshToken'

/**
 * リフレッシュトークン作成時の入力値。
 */
export type CreateRefreshTokenInput = {
  userId: number
  familyId: string
  tokenHash: string
  expiresAt: Date
}

/**
 * ローテーション結果。
 */
export type RotateRefreshTokenResult = { status: 'ROTATED'; refreshToken: RefreshToken } | { status: 'REUSED' }

/**
 * リフレッシュトークンのデータアクセスを提供するリポジトリ。
 */
export const refreshTokenRepository = {
  /**
   * リフレッシュトークンを作成する。
   */
  create: async (input: CreateRefreshTokenInput): Promise<RefreshToken> => {
    return prisma.refreshToken.create({ data: input })
  },

  /**
   * ハッシュ値でリフレッシュトークンを取得する。
   */
  findByTokenHash: async (tokenHash: string): Promise<RefreshToken | null> => {
    return prisma.refreshToken.findUnique({ where: { tokenHash } })
  },

  /**
   * 有効なリフレッシュトークンをIDで失効させる。
   */
  revokeById: async (id: number): Promise<boolean> => {
    const result = await prisma.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    return result.count > 0
  },

  /**
   * 同じfamilyに属する有効なリフレッシュトークンを全て失効させる。
   */
  revokeFamily: async (familyId: string): Promise<number> => {
    const result = await prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    return result.count
  },

  /**
   * 指定ユーザーに属する有効なリフレッシュセッションをfamilyIdで失効させる。
   */
  revokeByUserIdAndFamilyId: async (userId: number, familyId: string): Promise<number> => {
    const result = await prisma.refreshToken.updateMany({
      where: { userId, familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    return result.count
  },

  /**
   * 旧トークンの失効と新トークン作成を同一トランザクションで行う。
   * 旧トークンが既に失効している場合はfamilyを失効させ、再利用として返す。
   */
  rotate: async (currentId: number, input: CreateRefreshTokenInput): Promise<RotateRefreshTokenResult> => {
    return prisma.$transaction(async (tx) => {
      const revoked = await tx.refreshToken.updateMany({
        where: { id: currentId, familyId: input.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      })

      if (revoked.count === 0) {
        await tx.refreshToken.updateMany({
          where: { familyId: input.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        })
        return { status: 'REUSED' }
      }

      const refreshToken = await tx.refreshToken.create({ data: input })
      return { status: 'ROTATED', refreshToken }
    })
  },

  /**
   * 指定ユーザーのactiveなリフレッシュセッション一覧を取得する。
   * active行（未失効・未期限切れ）を取得し、対象family群のmin(createdAt)を別クエリで取得して
   * アプリ側で結合する。セッション開始日時(createdAt)はrevoked行を含むfamily内の最初のcreatedAt。
   * active行はfamilyあたり1行である前提（rotation/reuse検出のinvariant）。
   */
  findActiveSessionsByUserId: async (userId: number): Promise<RefreshSession[]> => {
    const now = new Date()
    // active行（未失効・未期限切れ）を取得する
    const activeRows = await prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now } },
      select: { familyId: true, expiresAt: true, createdAt: true },
    })

    if (activeRows.length === 0) {
      return []
    }

    const familyIds = activeRows.map((row) => row.familyId)
    // 対象family群の最初のcreatedAt（revoked行を含む）をgroupByで取得する。
    // familyIdはschema上uniqueではないため、集約側もuserIdで絞り、
    // 別ユーザーのcreatedAtが_min.createdAtへ混ざらないようユーザー境界を明確にする。
    const grouped = await prisma.refreshToken.groupBy({
      by: ['familyId'],
      where: { userId, familyId: { in: familyIds } },
      _min: { createdAt: true },
    })
    const minCreatedAtByFamily = new Map(grouped.map((group) => [group.familyId, group._min.createdAt]))

    return activeRows.map((row) => ({
      familyId: row.familyId,
      // family内の最初のcreatedAt。万一取得できない場合はactive行のcreatedAtへフォールバックする
      createdAt: minCreatedAtByFamily.get(row.familyId) ?? row.createdAt,
      expiresAt: row.expiresAt,
      lastUsedAt: row.createdAt,
    }))
  },

  /**
   * 指定ユーザーの全未失効リフレッシュトークンを失効させる。
   */
  revokeAllByUserId: async (userId: number, client: Prisma.TransactionClient = prisma): Promise<number> => {
    const result = await client.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    return result.count
  },
}
