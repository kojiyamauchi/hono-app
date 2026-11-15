import { refreshTokenRepository } from '@/shared/auth/repositories'
import { hashRefreshToken } from '@/shared/auth/services'

/**
 * ログアウトのビジネスロジック。
 */
export const logoutService = {
  /**
   * リフレッシュトークンのfamilyを失効させる。存在しない場合も成功として扱う。
   */
  execute: async (token: string): Promise<void> => {
    const current = await refreshTokenRepository.findByTokenHash(hashRefreshToken(token))
    if (current) {
      await refreshTokenRepository.revokeFamily(current.familyId)
    }
  },
}
