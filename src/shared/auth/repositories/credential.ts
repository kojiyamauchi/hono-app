import { prisma } from '@/libs/prisma'

import { refreshTokenRepository } from './refreshToken'

/**
 * 認証資格情報のデータアクセスを提供するリポジトリ。
 */
export const authCredentialRepository = {
  /**
   * パスワード更新と全リフレッシュトークン失効を同一トランザクションで行う。
   * 対象ユーザーが存在しない場合は false を返す。
   */
  changePassword: async (userId: number, hashedPassword: string): Promise<boolean> => {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: { id: userId },
        data: { password: hashedPassword },
      })

      if (updated.count === 0) {
        return false
      }

      await refreshTokenRepository.revokeAllByUserId(userId, tx)

      return true
    })
  },
}
