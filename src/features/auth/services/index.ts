import type { IssuedAuthTokens, SessionDtoType } from '@/shared/auth/dtos'
import { toSessionResponse } from '@/shared/auth/mappers'
import { authCredentialRepository, emailVerificationTokenRepository, passwordResetTokenRepository, refreshTokenRepository } from '@/shared/auth/repositories'
import {
  hashEmailVerificationToken,
  hashPasswordResetToken,
  hashRefreshToken,
  issueAuthToken,
  issuePasswordResetToken,
  issueRefreshToken,
  passwordResetNotifier,
  sendEmailVerificationBestEffort,
} from '@/shared/auth/services'
import type { UserDtoType } from '@/shared/user/dtos'
import type { User } from '@/shared/user/entities'
import { toUserResponse } from '@/shared/user/mappers'
import { userRepository } from '@/shared/user/repositories'
import { AppError } from '@/utils/errors'
import { createInMemoryRateLimiter } from '@/utils/rateLimit'
import { passwordResetRequestDelayMs } from '@/utils/timing'

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

/** メール検証メール再送のユーザー単位制限回数。 */
export const EMAIL_VERIFICATION_USER_RATE_LIMIT = 3

/** メール検証メール再送のユーザー単位制限期間（60分）。 */
export const EMAIL_VERIFICATION_USER_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

/** メール検証メール再送専用のインメモリレートリミッター。 */
export const emailVerificationRequestRateLimiter = createInMemoryRateLimiter()

/** ログインのIP単位制限回数。 */
export const LOGIN_IP_RATE_LIMIT = 5

/** ログインのIP単位制限期間（15分）。 */
export const LOGIN_IP_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000

/** ログインのemail単位制限回数。 */
export const LOGIN_EMAIL_RATE_LIMIT = 5

/** ログインのemail単位制限期間（15分）。 */
export const LOGIN_EMAIL_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000

/** サインアップのIP単位制限回数。 */
export const SIGNUP_IP_RATE_LIMIT = 5

/** サインアップのIP単位制限期間（15分）。 */
export const SIGNUP_IP_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000

/** ログイン専用のインメモリレートリミッター。 */
export const loginRateLimiter = createInMemoryRateLimiter()

/** サインアップ専用のインメモリレートリミッター。 */
export const signupRateLimiter = createInMemoryRateLimiter()

/**
 * レート制限用にメールアドレスを正規化する。
 */
const normalizeEmailForRateLimit = (email: string): string => email.trim().toLowerCase()

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
 * サインアップのIP単位レート制限キーを生成する。
 */
const signupIpRateLimitKey = (clientIp: string): string => {
  return `signup:ip:${clientIp}`
}

/**
 * メール検証メール再送のユーザー単位レート制限キーを生成する。
 */
const emailVerificationUserRateLimitKey = (userId: number): string => {
  return `email-verification:user:${userId}`
}

/**
 * パスワードリセットリクエスト用の最低応答時間＋ジッターを適用する。
 */
const waitPasswordResetRequestDelay = async (startMs: number): Promise<void> => {
  const delayMs = passwordResetRequestDelayMs(Date.now() - startMs)
  if (delayMs > 0) {
    await Bun.sleep(delayMs)
  }
}

/**
 * 認証に関するビジネスロジック。
 */
export const authService = {
  /**
   * サインアップ。メール重複を確認し、パスワードをハッシュ化して登録する。
   * clientIpが分かる場合はIP単位のレート制限を適用し、超過時は429を返す。
   * 重複メールは既に409で拒否されるため、email単位の制限は適用しない。
   */
  signup: async (input: SignupSchemaType, clientIp?: string): Promise<IssuedAuthTokens> => {
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

  /**
   * ログイン。メールでユーザーを引き、パスワードを検証してトークンを発行する。
   * clientIpが分かる場合はIP単位のレート制限を適用し、超過時は429を返す。
   * email単位の制限はアカウント列挙を防ぐため、ユーザー存在確認より前に必ず適用する
   * （clientIpの有無に関係なく常に実行する）。
   */
  login: async (input: LoginSchemaType, clientIp?: string): Promise<IssuedAuthTokens> => {
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
  getById: async (id: number): Promise<UserDtoType> => {
    const user = await userRepository.findById(id)
    if (!user) {
      throw new AppError(404, 'ユーザーが見つかりません')
    }
    return toUserResponse(user)
  },

  /**
   * ログイン済みユーザーのパスワードを変更する。
   * 成功時は全リフレッシュトークンを失効し、再ログインを要求する。
   */
  changePassword: async (userId: number, currentPassword: string, newPassword: string): Promise<void> => {
    const user = await userRepository.findById(userId)
    if (!user) {
      throw new AppError(404, 'ユーザーが見つかりません')
    }

    const isCurrentPasswordValid = await Bun.password.verify(currentPassword, user.password)
    if (!isCurrentPasswordValid) {
      throw new AppError(401, '現在のパスワードが正しくありません')
    }

    if (currentPassword === newPassword) {
      throw new AppError(400, '新しいパスワードは現在のパスワードと異なる値を入力してください')
    }

    const hashedPassword = await Bun.password.hash(newPassword)
    const changed = await authCredentialRepository.changePassword(userId, hashedPassword)

    if (!changed) {
      throw new AppError(404, 'ユーザーが見つかりません')
    }
  },

  /**
   * パスワードリセット用トークンを発行し、notifierへ送信を依頼する。
   * メールアドレスが登録済みかどうかにかかわらず、常に正常終了する（登録有無を外部に漏らさない）。
   * 同期送信による処理時間差を緩和するため、最低応答時間＋ジッターを確保する。
   * 通知失敗時は発行済みトークンをbest-effortで無効化する。
   */
  requestPasswordReset: async (email: string, clientIp?: string): Promise<void> => {
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
  confirmPasswordReset: async (token: string, password: string): Promise<void> => {
    const tokenHash = hashPasswordResetToken(token)
    const record = await passwordResetTokenRepository.findByTokenHash(tokenHash)

    if (!record || record.expiresAt <= new Date() || record.usedAt !== null) {
      throw new AppError(401, '無効なトークンです')
    }

    const hashedPassword = await Bun.password.hash(password)
    const success = await passwordResetTokenRepository.confirm(record.id, record.userId, hashedPassword)

    if (!success) {
      throw new AppError(401, '無効なトークンです')
    }
  },

  /**
   * 認証済みユーザーへメールアドレス検証メールを再送する。
   */
  requestEmailVerification: async (userId: number): Promise<void> => {
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
  confirmEmailVerification: async (token: string): Promise<void> => {
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

  /**
   * ログイン済みユーザーの全リフレッシュセッションを失効させる。
   * 失効対象が存在しない場合も正常終了する。
   */
  logoutAll: async (userId: number): Promise<void> => {
    await refreshTokenRepository.revokeAllByUserId(userId)
  },

  /**
   * ログイン済みユーザー自身の指定リフレッシュセッションを失効させる。
   * 存在しない・他ユーザー・失効済みは区別せず404へ畳み込む。
   */
  logoutSession: async (userId: number, sessionId: string): Promise<void> => {
    const revokedCount = await refreshTokenRepository.revokeByUserIdAndFamilyId(userId, sessionId)
    if (revokedCount === 0) {
      throw new AppError(404, 'セッションが見つかりません')
    }
  },

  /**
   * ログイン済みユーザーのactiveなリフレッシュセッション一覧を返す。
   * repositoryから取得したセッションをDTOへ変換し、tokenHash等の内部値は含めない。
   */
  listSessions: async (userId: number): Promise<SessionDtoType[]> => {
    const sessions = await refreshTokenRepository.findActiveSessionsByUserId(userId)
    return sessions.map(toSessionResponse)
  },
}
