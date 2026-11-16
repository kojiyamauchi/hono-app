import type { IssuedAuthTokens } from '@/shared/auth/dtos'
import { refreshTokenRepository } from '@/shared/auth/repositories/refreshToken'
import { hashRefreshToken, issueAuthToken, issueRefreshToken } from '@/shared/auth/services'
import { toUserResponse } from '@/shared/user/mappers'
import { userRepository } from '@/shared/user/repositories'
import { AppError } from '@/utils/errors'

/**
 * リフレッシュトークンが無効な場合の共通エラーを生成する。
 */
const invalidRefreshTokenError = (): AppError => new AppError(401, 'リフレッシュトークンが無効です')

/**
 * リフレッシュトークンのローテーションに関するビジネスロジック。
 */
export const refreshService = {
  /**
   * リフレッシュトークンをローテーションして新しい認証結果を返す。
   */
  execute: async (token: string): Promise<IssuedAuthTokens> => {
    const current = await refreshTokenRepository.findByTokenHash(hashRefreshToken(token))
    if (!current) {
      throw invalidRefreshTokenError()
    }

    if (current.revokedAt) {
      await refreshTokenRepository.revokeFamily(current.familyId)
      throw invalidRefreshTokenError()
    }

    if (current.expiresAt <= new Date()) {
      await refreshTokenRepository.revokeById(current.id)
      throw invalidRefreshTokenError()
    }

    const user = await userRepository.findById(current.userId)
    if (!user) {
      await refreshTokenRepository.revokeFamily(current.familyId)
      throw invalidRefreshTokenError()
    }

    const authToken = await issueAuthToken(user.id)
    const next = issueRefreshToken(current.familyId)
    const rotated = await refreshTokenRepository.rotate(current.id, {
      userId: current.userId,
      familyId: next.familyId,
      tokenHash: next.tokenHash,
      expiresAt: next.expiresAt,
    })

    // ローテーション成立（ROTATED）だけを成功として通し、未知の結果値はエラー側へ倒す（fail-closed）
    if (rotated.status !== 'ROTATED') {
      throw invalidRefreshTokenError()
    }

    return {
      token: authToken,
      refreshToken: next.token,
      user: toUserResponse(user),
    }
  },
}
