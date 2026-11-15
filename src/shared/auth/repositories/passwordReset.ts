import { prisma } from '@/libs/prisma'
import type { PasswordResetToken } from '@/shared/auth/entities/passwordReset'

import { refreshTokenRepository } from './refreshToken'

/**
 * パスワードリセットトークンのデータアクセスを提供するリポジトリ。
 */
export const passwordResetTokenRepository = {
  /**
   * パスワードリセットトークンを作成する。
   * 同一ユーザーの未使用・未失効の旧トークンを同一トランザクション内で無効化してから作成する。
   */
  create: async (userId: number, tokenHash: string, expiresAt: Date): Promise<PasswordResetToken> => {
    // userId は @unique。upsert は PostgreSQL では INSERT ... ON CONFLICT DO UPDATE に
    // コンパイルされ原子的なため、同一ユーザーへの並行requestでも常に1行に保たれる
    // （未認証requestの繰り返しによるレコード無制限増加を防ぐ）。
    return prisma.passwordResetToken.upsert({
      where: { userId },
      create: { userId, tokenHash, expiresAt },
      update: { tokenHash, expiresAt, usedAt: null },
    })
  },

  /**
   * ハッシュ値でパスワードリセットトークンを取得する。
   */
  findByTokenHash: async (tokenHash: string): Promise<PasswordResetToken | null> => {
    return prisma.passwordResetToken.findUnique({ where: { tokenHash } })
  },

  /**
   * IDでパスワードリセットトークンを無効化（削除）する。通知失敗時の補償処理に使用する。
   */
  deleteByIdAndTokenHash: async (id: number, tokenHash: string): Promise<number> => {
    // id だけでなく tokenHash の一致も条件にする。createがuserId基準のupsertで行IDを
    // 再利用するため、別requestが同じ行を新しいtokenHashへ更新済みの場合は削除件数0となり、
    // 後発の有効なトークンを誤って削除しない（通知失敗時の補償の安全化）。
    const result = await prisma.passwordResetToken.deleteMany({
      where: { id, tokenHash },
    })
    return result.count
  },

  /**
   * トークン消費・パスワード更新・全リフレッシュトークン失効を原子的に行う。
   * 並行実行時に1件だけ成功するよう条件付き updateMany でトークンを消費する。
   * 戻り値が false の場合はトークンが既に消費済みまたは並行競合を示す。
   */
  confirm: async (tokenId: number, userId: number, hashedPassword: string): Promise<boolean> => {
    return prisma.$transaction(async (tx) => {
      // 条件付き更新でトークンを消費する。未使用かつ有効期限内のみ消費し、
      // 期限切れ・使用済み・並行競合をすべて count===0（false）へ畳み込む。
      // serviceの事前チェックとtransaction開始の間に期限を跨いでも、ここで原子的に弾く。
      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: tokenId, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      })

      if (consumed.count === 0) {
        return false
      }

      // パスワードを更新する
      await tx.user.update({
        where: { id: userId },
        data: { password: hashedPassword },
      })

      // 同一トランザクション内で全リフレッシュトークンを失効させる（同じtxへ参加させる）
      await refreshTokenRepository.revokeAllByUserId(userId, tx)

      return true
    })
  },
}
