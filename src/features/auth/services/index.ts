import type { IssuedAuthTokens } from '@/shared/auth/dtos'
import { refreshTokenRepository } from '@/shared/auth/repositories'
import { hashRefreshToken, issueAuthToken, issueRefreshToken } from '@/shared/auth/services'
import type { UserResponse } from '@/shared/user/dtos'
import type { User } from '@/shared/user/entities'
import { toUserResponse } from '@/shared/user/mappers'
import { userRepository } from '@/shared/user/repositories'
import { AppError } from '@/utils/errors'

import type { LoginSchemaType, SignupSchemaType } from '../schemas'

/**
 * アクセストークンと新しいfamilyのリフレッシュトークンを発行する。
 */
const issueAuthentication = async (user: User): Promise<IssuedAuthTokens> => {
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
 * リフレッシュトークンが無効な場合の共通エラーを生成する。
 */
const invalidRefreshTokenError = (): AppError => new AppError(401, 'リフレッシュトークンが無効です')

/**
 * 認証に関するビジネスロジック。
 */
export const authService = {
  /**
   * サインアップ。メール重複を確認し、パスワードをハッシュ化して登録する。
   */
  signup: async (input: SignupSchemaType): Promise<IssuedAuthTokens> => {
    const existing = await userRepository.findByEmail(input.email)
    if (existing) {
      throw new AppError(409, 'このメールアドレスは既に登録されています')
    }

    const hashedPassword = await Bun.password.hash(input.password)
    const user = await userRepository.create({
      name: input.name,
      email: input.email,
      password: hashedPassword,
    })

    return issueAuthentication(user)
  },

  /**
   * ログイン。メールでユーザーを引き、パスワードを検証してトークンを発行する。
   */
  login: async (input: LoginSchemaType): Promise<IssuedAuthTokens> => {
    const user = await userRepository.findByEmail(input.email)
    if (!user) {
      throw new AppError(401, 'メールアドレスまたはパスワードが正しくありません')
    }

    const isValid = await Bun.password.verify(input.password, user.password)
    if (!isValid) {
      throw new AppError(401, 'メールアドレスまたはパスワードが正しくありません')
    }

    return issueAuthentication(user)
  },

  /**
   * リフレッシュトークンをローテーションして新しい認証結果を返す。
   */
  refresh: async (token: string): Promise<IssuedAuthTokens> => {
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

    if (rotated.status === 'REUSED') {
      throw invalidRefreshTokenError()
    }

    return {
      token: authToken,
      refreshToken: next.token,
      user: toUserResponse(user),
    }
  },

  /**
   * リフレッシュトークンのfamilyを失効させる。存在しない場合も成功として扱う。
   */
  logout: async (token: string): Promise<void> => {
    const current = await refreshTokenRepository.findByTokenHash(hashRefreshToken(token))
    if (current) {
      await refreshTokenRepository.revokeFamily(current.familyId)
    }
  },

  /**
   * IDでユーザー情報を取得する（/auth/me 用）。
   */
  getById: async (id: number): Promise<UserResponse> => {
    const user = await userRepository.findById(id)
    if (!user) {
      throw new AppError(404, 'ユーザーが見つかりません')
    }
    return toUserResponse(user)
  },
}
