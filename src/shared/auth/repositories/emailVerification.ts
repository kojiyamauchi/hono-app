import { prisma } from '@/libs/prisma'
import type { EmailVerificationToken } from '@/shared/auth/entities/emailVerification'

/**
 * メールアドレス検証トークンのデータアクセスを提供するリポジトリ。
 */
export const emailVerificationTokenRepository = {
  /**
   * メールアドレス検証トークンを作成する。
   * userId一意のupsertにより、再送時は旧トークンを原子的に置き換える。
   */
  create: async (userId: number, tokenHash: string, expiresAt: Date): Promise<EmailVerificationToken> => {
    return prisma.emailVerificationToken.upsert({
      where: { userId },
      create: { userId, tokenHash, expiresAt },
      update: { tokenHash, expiresAt, usedAt: null },
    })
  },

  /**
   * ハッシュ値でメールアドレス検証トークンを取得する。
   */
  findByTokenHash: async (tokenHash: string): Promise<EmailVerificationToken | null> => {
    return prisma.emailVerificationToken.findUnique({ where: { tokenHash } })
  },

  /**
   * 通知失敗時に、自分が発行したトークンだけを削除する。
   */
  deleteByIdAndTokenHash: async (id: number, tokenHash: string): Promise<number> => {
    const result = await prisma.emailVerificationToken.deleteMany({ where: { id, tokenHash } })
    return result.count
  },

  /**
   * トークン消費とメールアドレス検証日時の更新を原子的に行う。
   * 期限切れ・使用済み・並行競合の場合はfalseを返す。
   */
  confirm: async (tokenId: number, userId: number): Promise<boolean> => {
    return prisma.$transaction(async (tx) => {
      const verifiedAt = new Date()
      const consumed = await tx.emailVerificationToken.updateMany({
        where: { id: tokenId, usedAt: null, expiresAt: { gt: verifiedAt } },
        data: { usedAt: verifiedAt },
      })

      if (consumed.count === 0) {
        return false
      }

      await tx.user.update({
        where: { id: userId },
        data: { emailVerifiedAt: verifiedAt },
      })

      return true
    })
  },
}
