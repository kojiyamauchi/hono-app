import type { SessionDtoType } from '@/shared/auth/dtos'
import { toSessionResponse } from '@/shared/auth/mappers'
import { refreshTokenRepository } from '@/shared/auth/repositories'
import { AppError } from '@/utils/errors'

/**
 * リフレッシュセッションに関するビジネスロジック。
 */
export const sessionsService = {
  /**
   * ログイン済みユーザー自身の指定リフレッシュセッションを失効させる。
   * 存在しない・他ユーザー・失効済みは区別せず404へ畳み込む。
   */
  revoke: async (userId: number, sessionId: string): Promise<void> => {
    const revokedCount = await refreshTokenRepository.revokeByUserIdAndFamilyId(userId, sessionId)
    if (revokedCount === 0) {
      throw new AppError(404, 'セッションが見つかりません')
    }
  },

  /**
   * ログイン済みユーザーのactiveなリフレッシュセッション一覧を返す。
   * repositoryから取得したセッションをDTOへ変換し、tokenHash等の内部値は含めない。
   */
  list: async (userId: number): Promise<SessionDtoType[]> => {
    const sessions = await refreshTokenRepository.findActiveSessionsByUserId(userId)
    return sessions.map(toSessionResponse)
  },
}
