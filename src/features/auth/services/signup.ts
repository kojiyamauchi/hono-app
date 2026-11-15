import type { IssuedAuthTokens } from '@/shared/auth/dtos'
import { sendEmailVerificationBestEffort } from '@/shared/auth/services/emailVerification'
import { userRepository } from '@/shared/user/repositories'
import { AppError } from '@/utils/errors'
import { createInMemoryRateLimiter } from '@/utils/rateLimit'

import type { BodySchemaType } from '../schemas/signup'
import { issueAuthentication } from './common'

/** サインアップのIP単位制限回数。 */
export const SIGNUP_IP_RATE_LIMIT = 5

/** サインアップのIP単位制限期間（15分）。 */
export const SIGNUP_IP_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000

/** サインアップ専用のインメモリレートリミッター。 */
export const signupRateLimiter = createInMemoryRateLimiter()

/**
 * サインアップのIP単位レート制限キーを生成する。
 */
const signupIpRateLimitKey = (clientIp: string): string => {
  return `signup:ip:${clientIp}`
}

/**
 * サインアップのビジネスロジック。
 */
export const signupService = {
  /**
   * サインアップ。メール重複を確認し、パスワードをハッシュ化して登録する。
   * clientIpが分かる場合はIP単位のレート制限を適用し、超過時は429を返す。
   * 重複メールは既に409で拒否されるため、email単位の制限は適用しない。
   */
  execute: async (input: BodySchemaType, clientIp?: string): Promise<IssuedAuthTokens> => {
    if (clientIp) {
      const ipRateLimit = signupRateLimiter.check({
        key: signupIpRateLimitKey(clientIp),
        limit: SIGNUP_IP_RATE_LIMIT,
        windowMs: SIGNUP_IP_RATE_LIMIT_WINDOW_MS,
      })
      if (!ipRateLimit.allowed) {
        // IP単位の制限はアカウント非依存のtransport層制限として429を返す。
        // IPなどの機密/個人情報はログに含めない。
        console.info('サインアップをIP単位で制限しました', {
          scope: 'ip',
          retryAfterMs: ipRateLimit.retryAfterMs,
        })
        throw new AppError(429, 'リクエストが多すぎます。しばらくしてから再試行してください')
      }
    }

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

    if (!user) {
      // 事前のfindByEmailをすり抜けた同時signupの競合。DBの一意制約違反（P2002）は
      // repositoryでnullへ畳み込まれるため、ここで409へ変換する（最終防衛はDB制約）。
      throw new AppError(409, 'このメールアドレスは既に登録されています')
    }

    await sendEmailVerificationBestEffort(user.id, user.email)

    return issueAuthentication(user)
  },
}
