import type { IssuedAuthTokens } from '@/shared/auth/dtos'
import { refreshTokenRepository } from '@/shared/auth/repositories'
import { issueAuthToken, issueRefreshToken } from '@/shared/auth/services'
import type { User } from '@/shared/user/entities'
import { toUserResponse } from '@/shared/user/mappers'

/**
 * アクセストークンと新しいfamilyのリフレッシュトークンを発行する。
 */
export const issueAuthentication = async (user: User): Promise<IssuedAuthTokens> => {
  const token = await issueAuthToken(user.id)
  const refreshToken = issueRefreshToken()
  await refreshTokenRepository.create({
    userId: user.id,
    familyId: refreshToken.familyId,
    tokenHash: refreshToken.tokenHash,
    expiresAt: refreshToken.expiresAt,
  })

  return {
    token,
    refreshToken: refreshToken.token,
    user: toUserResponse(user),
  }
}

/**
 * レート制限用にメールアドレスを正規化する。
 */
export const normalizeEmailForRateLimit = (email: string): string => email.trim().toLowerCase()
