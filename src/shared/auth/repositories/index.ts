import { prisma } from '@/libs/prisma'
import type { RefreshToken } from '@/shared/auth/entities'

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
}
