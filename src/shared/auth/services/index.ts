import { createHmac, randomBytes, randomUUID } from 'node:crypto'

import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { sign } from 'hono/jwt'

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

/** リフレッシュトークンCookieの名前。 */
export const REFRESH_TOKEN_COOKIE_NAME = 'refreshToken'

/**
 * リフレッシュトークンをHttpOnly CookieへセットするCookieヘルパー。
 * Secure属性は本番環境でのみ有効にする。
 */
export const setRefreshTokenCookie = (c: Context, token: string): void => {
  setCookie(c, REFRESH_TOKEN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
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
 * 削除時も設定時と同じPathを指定する。
 */
export const clearRefreshTokenCookie = (c: Context): void => {
  deleteCookie(c, REFRESH_TOKEN_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/auth',
  })
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
