import type { IssuedAuthTokens } from '@/shared/auth/dtos'
import { refreshTokenRepository } from '@/shared/auth/repositories/refreshToken'
import { issueAuthToken, issueRefreshToken, sendEmailVerificationBestEffort } from '@/shared/auth/services'
import { invitationRepository } from '@/shared/invitation/repositories'
import { toUserResponse } from '@/shared/user/mappers'
import { userRepository } from '@/shared/user/repositories'
import { AppError } from '@/utils/errors'

import { findPendingValidInvitation } from './common'

/**
 * 招待経由サインアップのユースケースを提供するサービス。
 */
export const signupService = {
  /**
   * 招待トークンを使ってユーザー登録し、組織メンバーになる。
   *
   * 1. トークンからPENDINGかつ有効な招待を取得（無ければ404、不正ステータス/期限切れは409）
   * 2. 招待メールアドレスのユーザーが既に存在する場合は409
   * 3. パスワードをハッシュ化する
   * 4. トランザクションでユーザー作成、membership作成、招待ACCEPTED更新を行う（nullなら409）
   * 5. JWTを発行して認証レスポンスを返す
   */
  execute: async (token: string, name: string, password: string): Promise<IssuedAuthTokens> => {
    // 1. PENDINGかつ有効な招待を取得
    const invitation = await findPendingValidInvitation(token)

    // 2. 招待メールアドレスのユーザーが既に存在する場合は409
    const existing = await userRepository.findByEmail(invitation.email)
    if (existing) {
      throw new AppError(409, 'このメールアドレスは既に登録されています')
    }

    // 3. パスワードをハッシュ化
    const hashedPassword = await Bun.password.hash(password)

    // 4. トランザクションでユーザー作成、membership作成、招待ACCEPTED更新
    const user = await invitationRepository.signup(invitation.id, invitation.organizationId, invitation.email, name, hashedPassword, invitation.role)
    if (!user) {
      throw new AppError(409, '招待経由の登録に失敗しました')
    }

    await sendEmailVerificationBestEffort(user.id, user.email)

    // 5. アクセストークンとリフレッシュトークンを発行して認証レスポンスを返す
    const authToken = await issueAuthToken(user.id)
    const refreshToken = issueRefreshToken()
    await refreshTokenRepository.create({
      userId: user.id,
      familyId: refreshToken.familyId,
      tokenHash: refreshToken.tokenHash,
      expiresAt: refreshToken.expiresAt,
    })
    return { token: authToken, refreshToken: refreshToken.token, user: toUserResponse(user) }
  },
}
