import { refreshTokenRepository } from '@/shared/auth/repositories'

/**
 * 全セッションログアウトのビジネスロジック。
 */
export const logoutAllService = {
  /**
   * ログイン済みユーザーの全リフレッシュセッションを失効させる。
   * 失効対象が存在しない場合も正常終了する。
   */
  execute: async (userId: number): Promise<void> => {
    await refreshTokenRepository.revokeAllByUserId(userId)
  },
}
