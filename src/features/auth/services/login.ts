import type { IssuedAuthTokens } from '@/shared/auth/dtos'
import { hashPasswordResetToken } from '@/shared/auth/services'
import { userRepository } from '@/shared/user/repositories'
import { AppError } from '@/utils/errors'
import { createInMemoryRateLimiter } from '@/utils/rateLimit'

import type { BodySchemaType } from '../schemas/login'
import { issueAuthentication, normalizeEmailForRateLimit } from './common'

/** ログインのIP単位制限回数。 */
export const LOGIN_IP_RATE_LIMIT = 5

/** ログインのIP単位制限期間（15分）。 */
export const LOGIN_IP_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000

/** ログインのemail単位制限回数。 */
export const LOGIN_EMAIL_RATE_LIMIT = 5

/** ログインのemail単位制限期間（15分）。 */
export const LOGIN_EMAIL_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000

/** ログイン専用のインメモリレートリミッター。 */
export const loginRateLimiter = createInMemoryRateLimiter()

/**
 * ログインのIP単位レート制限キーを生成する。
 */
const loginIpRateLimitKey = (clientIp: string): string => {
  return `login:ip:${clientIp}`
}

/**
 * 平文メールアドレスを保存しないため、ログインのemail単位レート制限キーはHMAC化する。
 */
const loginEmailRateLimitKey = (email: string): string => {
  return `login:email:${hashPasswordResetToken(normalizeEmailForRateLimit(email))}`
}

/**
 * ログインのビジネスロジック。
 */
export const loginService = {
  /**
   * ログイン。メールでユーザーを引き、パスワードを検証してトークンを発行する。
   * clientIpが分かる場合はIP単位のレート制限を適用し、超過時は429を返す。
   * email単位の制限はアカウント列挙を防ぐため、ユーザー存在確認より前に必ず適用する
   * （clientIpの有無に関係なく常に実行する）。
   */
  execute: async (input: BodySchemaType, clientIp?: string): Promise<IssuedAuthTokens> => {
    if (clientIp) {
      const ipRateLimit = loginRateLimiter.check({
        key: loginIpRateLimitKey(clientIp),
        limit: LOGIN_IP_RATE_LIMIT,
        windowMs: LOGIN_IP_RATE_LIMIT_WINDOW_MS,
      })
      if (!ipRateLimit.allowed) {
        // IP単位の制限はアカウント非依存のtransport層制限として429を返す。
        // IPなどの機密/個人情報はログに含めない。
        console.info('ログインをIP単位で制限しました', {
          scope: 'ip',
          retryAfterMs: ipRateLimit.retryAfterMs,
        })
        throw new AppError(429, 'リクエストが多すぎます。しばらくしてから再試行してください')
      }
    }

    const emailRateLimit = loginRateLimiter.check({
      key: loginEmailRateLimitKey(input.email),
      limit: LOGIN_EMAIL_RATE_LIMIT,
      windowMs: LOGIN_EMAIL_RATE_LIMIT_WINDOW_MS,
    })
    if (!emailRateLimit.allowed) {
      // email単位の制限は登録有無にかかわらず同じ挙動になるよう、
      // ユーザー存在確認より前に適用する（アカウント列挙を防ぐ）。
      // 平文メールアドレスはログに含めない。
      console.info('ログインをemail単位で制限しました', {
        scope: 'email',
        retryAfterMs: emailRateLimit.retryAfterMs,
      })
      throw new AppError(429, 'リクエストが多すぎます。しばらくしてから再試行してください')
    }

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
}
