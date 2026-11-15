import { emailVerificationTokenRepository } from '@/shared/auth/repositories/emailVerification'
import { hashEmailVerificationToken, sendEmailVerificationBestEffort } from '@/shared/auth/services'
import { userRepository } from '@/shared/user/repositories'
import { AppError } from '@/utils/errors'
import { createInMemoryRateLimiter } from '@/utils/rateLimit'

/** メール検証メール再送のユーザー単位制限回数。 */
export const EMAIL_VERIFICATION_USER_RATE_LIMIT = 3

/** メール検証メール再送のユーザー単位制限期間（60分）。 */
export const EMAIL_VERIFICATION_USER_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

/** メール検証メール再送専用のインメモリレートリミッター。 */
export const emailVerificationRequestRateLimiter = createInMemoryRateLimiter()

/**
 * メール検証メール再送のユーザー単位レート制限キーを生成する。
 */
const emailVerificationUserRateLimitKey = (userId: number): string => {
  return `email-verification:user:${userId}`
}

/**
 * メールアドレス検証のビジネスロジック。
 */
export const emailVerificationService = {
  /**
   * 認証済みユーザーへメールアドレス検証メールを再送する。
   */
  request: async (userId: number): Promise<void> => {
    const user = await userRepository.findById(userId)
    if (!user) {
      throw new AppError(404, 'ユーザーが見つかりません')
    }
    if (user.emailVerifiedAt !== null) {
      throw new AppError(409, 'メールアドレスは既に検証済みです')
    }

    const rateLimit = emailVerificationRequestRateLimiter.check({
      key: emailVerificationUserRateLimitKey(userId),
      limit: EMAIL_VERIFICATION_USER_RATE_LIMIT,
      windowMs: EMAIL_VERIFICATION_USER_RATE_LIMIT_WINDOW_MS,
    })
    if (!rateLimit.allowed) {
      console.info('メールアドレス検証メールの再送をユーザー単位で制限しました', {
        scope: 'user',
        retryAfterMs: rateLimit.retryAfterMs,
      })
      throw new AppError(429, 'リクエストが多すぎます。しばらくしてから再試行してください')
    }

    await sendEmailVerificationBestEffort(user.id, user.email)
  },

  /**
   * メールアドレス検証トークンを検証し、対象ユーザーを検証済みにする。
   */
  confirm: async (token: string): Promise<void> => {
    const tokenHash = hashEmailVerificationToken(token)
    const record = await emailVerificationTokenRepository.findByTokenHash(tokenHash)

    if (!record || record.expiresAt <= new Date() || record.usedAt !== null) {
      throw new AppError(401, '無効なトークンです')
    }

    const success = await emailVerificationTokenRepository.confirm(record.id, record.userId)
    if (!success) {
      throw new AppError(401, '無効なトークンです')
    }
  },
}
