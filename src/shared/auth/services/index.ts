import { createHmac, randomBytes, randomUUID } from 'node:crypto'

import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { sign } from 'hono/jwt'

import { sendResendEmail } from '@/libs/resend'
import { resolveExternalApiErrorType, resolveExternalApiStatusCode, traceExternalApiCall } from '@/libs/telemetry/external'
import { AppError } from '@/utils/errors'

/**
 * 環境変数からJWT署名用のシークレットを取得する。未設定なら500エラー。
 */
const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new AppError(500, 'JWT_SECRETが設定されていません')
  }
  return secret
}

/**
 * 環境変数からリフレッシュトークンのHMAC鍵を取得する。未設定なら500エラー。
 */
const getRefreshTokenSecret = (): string => {
  const secret = process.env.REFRESH_TOKEN_SECRET
  if (!secret) {
    throw new AppError(500, 'REFRESH_TOKEN_SECRETが設定されていません')
  }
  return secret
}

/** アクセストークンの有効期間（15分）。 */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60

/** リフレッシュトークンの有効期間（14日）。 */
export const REFRESH_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000

/** パスワードリセットトークンの有効期間（1時間）。 */
export const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000

/** リフレッシュトークンCookieの名前。 */
export const REFRESH_TOKEN_COOKIE_NAME = 'refreshToken'

/**
 * CookieのSameSite属性を環境変数 COOKIE_SAMESITE から決定する。
 * 'Strict' / 'None' を指定でき、未設定・不正値は 'Lax'（既定）。
 * フロントエンドとAPIがcross-siteになる構成では 'None' を指定する（その場合Secureが必須）。
 */
const getCookieSameSite = (): 'Strict' | 'Lax' | 'None' => {
  const value = process.env.COOKIE_SAMESITE
  if (value === 'Strict' || value === 'None') {
    return value
  }
  return 'Lax'
}

/**
 * CookieのSecure属性を決定する。
 * 既定は安全側（有効）とし、ローカルHTTP開発など明示的に COOKIE_SECURE=false の場合のみ無効化する。
 * SameSite=None はブラウザ仕様上Secureが必須のため、その場合は常に有効にする。
 */
const isCookieSecure = (): boolean => {
  if (getCookieSameSite() === 'None') {
    return true
  }
  return process.env.COOKIE_SECURE !== 'false'
}

/**
 * リフレッシュトークンをHttpOnly Cookieへセットする。
 * Secure / SameSite は環境変数で制御する（既定はSecure有効・SameSite=Lax）。
 */
export const setRefreshTokenCookie = (c: Context, token: string): void => {
  setCookie(c, REFRESH_TOKEN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isCookieSecure(),
    sameSite: getCookieSameSite(),
    path: '/auth',
    maxAge: Math.floor(REFRESH_TOKEN_TTL_MS / 1000),
  })
}

/**
 * リフレッシュトークンをCookieから取得する。
 */
export const getRefreshTokenCookie = (c: Context): string | undefined => {
  return getCookie(c, REFRESH_TOKEN_COOKIE_NAME)
}

/**
 * リフレッシュトークンCookieを削除する。
 * 削除時も設定時と同じ属性（Secure / SameSite / Path）を指定する。
 */
export const clearRefreshTokenCookie = (c: Context): void => {
  deleteCookie(c, REFRESH_TOKEN_COOKIE_NAME, {
    httpOnly: true,
    secure: isCookieSecure(),
    sameSite: getCookieSameSite(),
    path: '/auth',
  })
}

/**
 * 環境変数からパスワードリセットトークンのHMAC鍵を取得する。未設定なら500エラー。
 */
const getPasswordResetTokenSecret = (): string => {
  const secret = process.env.PASSWORD_RESET_TOKEN_SECRET
  if (!secret) {
    throw new AppError(500, 'PASSWORD_RESET_TOKEN_SECRETが設定されていません')
  }
  return secret
}

/**
 * 発行したリフレッシュトークンと永続化に必要な値。
 */
export type IssuedRefreshToken = {
  token: string
  tokenHash: string
  familyId: string
  expiresAt: Date
}

/**
 * 指定ユーザーIDのアクセストークンを発行する。
 */
export const issueAuthToken = async (userId: number): Promise<string> => {
  const payload = {
    sub: userId,
    exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS,
  }
  return sign(payload, getJwtSecret())
}

/**
 * リフレッシュトークンをHMAC-SHA256でハッシュ化する。
 */
export const hashRefreshToken = (token: string): string => {
  return createHmac('sha256', getRefreshTokenSecret()).update(token).digest('hex')
}

/**
 * リフレッシュトークンと永続化に必要な値を生成する。
 * familyIdを指定した場合は同じログインセッションのローテーションとして発行する。
 */
export const issueRefreshToken = (familyId: string = randomUUID()): IssuedRefreshToken => {
  const token = randomBytes(32).toString('base64url')
  return {
    token,
    tokenHash: hashRefreshToken(token),
    familyId,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  }
}

/**
 * パスワードリセットトークンをHMAC-SHA256でハッシュ化する。
 * 鍵には PASSWORD_RESET_TOKEN_SECRET を使用する。
 */
export const hashPasswordResetToken = (token: string): string => {
  return createHmac('sha256', getPasswordResetTokenSecret()).update(token).digest('hex')
}

/**
 * 発行したパスワードリセットトークンと永続化に必要な値。
 */
export type IssuedPasswordResetToken = {
  token: string
  tokenHash: string
  expiresAt: Date
}

/**
 * パスワードリセットトークンと永続化に必要な値を生成する。
 * 有効期間は PASSWORD_RESET_TOKEN_TTL_MS（1時間）。
 */
export const issuePasswordResetToken = (): IssuedPasswordResetToken => {
  const token = randomBytes(32).toString('base64url')
  return {
    token,
    tokenHash: hashPasswordResetToken(token),
    expiresAt: new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS),
  }
}

/**
 * パスワードリセット通知の送信パラメータ。
 */
export type PasswordResetNotifierParams = {
  email: string
  token: string
}

/**
 * パスワードリセット通知の境界インタフェース。
 * 実Resend配送はIssue #44で実装する。
 */
export type PasswordResetNotifier = {
  send: (params: PasswordResetNotifierParams) => Promise<void>
}

/**
 * 環境変数からパスワードリセットメールの送信元アドレスを取得する。未設定なら500エラー。
 */
const getPasswordResetFromEmail = (): string => {
  const from = process.env.PASSWORD_RESET_FROM_EMAIL
  if (!from) {
    throw new AppError(500, 'PASSWORD_RESET_FROM_EMAILが設定されていません')
  }
  return from
}

/**
 * 環境変数からパスワードリセットページのベースURLを取得する。未設定なら500エラー。
 */
const getPasswordResetUrlBase = (): string => {
  const urlBase = process.env.PASSWORD_RESET_URL_BASE
  if (!urlBase) {
    throw new AppError(500, 'PASSWORD_RESET_URL_BASEが設定されていません')
  }
  return urlBase
}

/**
 * パスワードリセット通知のResend実装。
 * Resend APIを使い、リセットURLを含むメールを送信する。
 * 平文トークン・メールアドレス・APIキーをログへ出力しない。
 * Resendが同期的にエラーを返した場合はthrowし、呼び出し元の補償処理を起動する。
 */
export const passwordResetNotifier: PasswordResetNotifier = {
  send: async (params: PasswordResetNotifierParams): Promise<void> => {
    const from = getPasswordResetFromEmail()
    const urlBase = getPasswordResetUrlBase()
    const resetUrl = `${urlBase}?token=${params.token}`
    const ttlHours = PASSWORD_RESET_TOKEN_TTL_MS / (60 * 60 * 1000)

    const { error } = await traceExternalApiCall(
      {
        host: 'api.resend.com',
        method: 'POST',
        operation: 'emails.send',
        resolveResult: (result: Awaited<ReturnType<typeof sendResendEmail>>) => ({
          errorType: resolveExternalApiErrorType(result.error),
          statusCode: resolveExternalApiStatusCode(result.error),
          success: !result.error,
        }),
        system: 'resend',
      },
      () =>
        sendResendEmail({
          from,
          to: params.email,
          subject: 'パスワード再設定のご案内',
          text: [
            'パスワードの再設定が申請されました。',
            '',
            '以下のURLからパスワードを再設定してください。',
            resetUrl,
            '',
            `このURLの有効期限は${ttlHours}時間です。`,
            '',
            'このメールに心当たりがない場合は、操作は不要です。このメールを無視してください。',
            'パスワードやリセット用URLを他者へ共有・返信しないでください。',
          ].join('\n'),
          html: [
            '<p>パスワードの再設定が申請されました。</p>',
            '<p>以下のURLからパスワードを再設定してください。</p>',
            `<p><a href="${resetUrl}">${resetUrl}</a></p>`,
            `<p>このURLの有効期限は${ttlHours}時間です。</p>`,
            '<hr>',
            '<p>このメールに心当たりがない場合は、操作は不要です。このメールを無視してください。</p>',
            '<p>パスワードやリセット用URLを他者へ共有・返信しないでください。</p>',
          ].join('\n'),
        }),
    )

    if (error) {
      // Resend APIがエラーを返した場合はthrowし、呼び出し元の補償処理を起動する
      throw new Error(`メール送信に失敗しました: ${error.name}`)
    }
  },
}

export * from './emailVerification'
