import { passwordResetTokenRepository } from '@/shared/auth/repositories/passwordReset'
import { hashPasswordResetToken, issuePasswordResetToken, passwordResetNotifier } from '@/shared/auth/services/passwordReset'
import { userRepository } from '@/shared/user/repositories'
import { AppError } from '@/utils/errors'
import { createInMemoryRateLimiter } from '@/utils/rateLimit'
import { hashPassword, sleep } from '@/utils/runtime'
import { passwordResetRequestDelayMs } from '@/utils/timing'

import { normalizeEmailForRateLimit } from './common'

/** パスワードリセットリクエストのIP単位制限回数。 */
export const PASSWORD_RESET_IP_RATE_LIMIT = 5

/** パスワードリセットリクエストのIP単位制限期間（15分）。 */
export const PASSWORD_RESET_IP_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000

/** パスワードリセットリクエストのemail単位制限回数。 */
export const PASSWORD_RESET_EMAIL_RATE_LIMIT = 3

/** パスワードリセットリクエストのemail単位制限期間（1時間）。 */
export const PASSWORD_RESET_EMAIL_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

/** パスワードリセットリクエスト専用のインメモリレートリミッター。 */
export const passwordResetRequestRateLimiter = createInMemoryRateLimiter()

/**
 * 平文メールアドレスを保存しないため、レート制限用emailキーはHMAC化する。
 */
const passwordResetEmailRateLimitKey = (email: string): string => {
  return `password-reset:email:${hashPasswordResetToken(normalizeEmailForRateLimit(email))}`
}

/**
 * IP単位のレート制限キーを生成する。
 */
const passwordResetIpRateLimitKey = (clientIp: string): string => {
  return `password-reset:ip:${clientIp}`
}

/**
 * パスワードリセットリクエスト用の最低応答時間＋ジッターを適用する。
 */
const waitPasswordResetRequestDelay = async (startMs: number): Promise<void> => {
  const delayMs = passwordResetRequestDelayMs(Date.now() - startMs)
  if (delayMs > 0) {
    await sleep(delayMs)
  }
}

/**
 * パスワードリセットのビジネスロジック。
 */
export const passwordResetService = {
  /**
   * パスワードリセット用トークンを発行し、notifierへ送信を依頼する。
   * メールアドレスが登録済みかどうかにかかわらず、常に正常終了する（登録有無を外部に漏らさない）。
   * 同期送信による処理時間差を緩和するため、最低応答時間＋ジッターを確保する。
   * 通知失敗時は発行済みトークンをbest-effortで無効化する。
   */
  request: async (email: string, clientIp?: string): Promise<void> => {
    const startMs = Date.now()

    if (clientIp) {
      const ipRateLimit = passwordResetRequestRateLimiter.check({
        key: passwordResetIpRateLimitKey(clientIp),
        limit: PASSWORD_RESET_IP_RATE_LIMIT,
        windowMs: PASSWORD_RESET_IP_RATE_LIMIT_WINDOW_MS,
      })
      if (!ipRateLimit.allowed) {
        // IP単位の制限はアカウント非依存のtransport層制限として429を返す。
        // IP・メール・トークンなどの機密/個人情報はログに含めない。
        console.info('パスワードリセットリクエストをIP単位で制限しました', {
          scope: 'ip',
          retryAfterMs: ipRateLimit.retryAfterMs,
        })
        throw new AppError(429, 'リクエストが多すぎます。しばらくしてから再試行してください')
      }
    }

    const emailRateLimit = passwordResetRequestRateLimiter.check({
      key: passwordResetEmailRateLimitKey(email),
      limit: PASSWORD_RESET_EMAIL_RATE_LIMIT,
      windowMs: PASSWORD_RESET_EMAIL_RATE_LIMIT_WINDOW_MS,
    })
    if (!emailRateLimit.allowed) {
      // email単位の制限結果は外部に出さず、通常の202経路と区別しにくいよう最低応答時間＋ジッターを通す。
      // 平文メールアドレスはログに含めない。
      console.info('パスワードリセットリクエストをemail単位で制限しました', {
        scope: 'email',
        retryAfterMs: emailRateLimit.retryAfterMs,
      })
      await waitPasswordResetRequestDelay(startMs)
      return
    }

    const user = await userRepository.findByEmail(email)
    if (!user) {
      // 未登録の場合も遅延を挿入してから正常終了する（タイミングによる登録有無の漏えいを防ぐ）
      await waitPasswordResetRequestDelay(startMs)
      return
    }

    const issued = issuePasswordResetToken()
    const saved = await passwordResetTokenRepository.create(user.id, issued.tokenHash, issued.expiresAt)

    try {
      await passwordResetNotifier.send({ email, token: issued.token })
    } catch (error) {
      // 配送失敗は運用が検知できるようログに残す。
      // メールアドレス・平文トークン・APIキーなどの機密は含めず、エラー種別/メッセージのみ記録する。
      console.error('パスワードリセットメールの配送に失敗しました', {
        name: error instanceof Error ? error.name : 'UnknownError',
        reason: error instanceof Error ? error.message : 'unknown',
      })
      // 通知失敗時はbest-effortで「自分が発行したトークン」だけを削除する。
      // id と tokenHash の両方を条件にし、並行requestが同じ行を更新済みの場合は削除しない。
      // 補償削除自体の失敗は握りつぶす（best-effort）。requestは登録有無・通知/補償結果に
      // よらず常に202で正常終了し、列挙防止のためレスポンスを変えない。
      await passwordResetTokenRepository.deleteByIdAndTokenHash(saved.id, issued.tokenHash).catch(() => {
        // 補償削除に失敗しても無視する（トークンは有効期限で失効する）
      })
    }

    // 登録済みパスの遅延挿入（送信成功・失敗いずれも同じ遅延を適用する）
    await waitPasswordResetRequestDelay(startMs)
  },

  /**
   * パスワードリセットトークンを検証し、新しいパスワードを設定する。
   * トークンが無効・期限切れ・使用済みの場合はすべて同一の401エラーを返す。
   * 成功後はアクセストークン・リフレッシュトークンを返さない（再ログインを要求する）。
   */
  confirm: async (token: string, password: string): Promise<void> => {
    const tokenHash = hashPasswordResetToken(token)
    const record = await passwordResetTokenRepository.findByTokenHash(tokenHash)

    if (!record || record.expiresAt <= new Date() || record.usedAt !== null) {
      throw new AppError(401, '無効なトークンです')
    }

    const hashedPassword = await hashPassword(password)
    const success = await passwordResetTokenRepository.confirm(record.id, record.userId, hashedPassword)

    if (!success) {
      throw new AppError(401, '無効なトークンです')
    }
  },
}
