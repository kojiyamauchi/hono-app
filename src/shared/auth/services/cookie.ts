import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'

import { REFRESH_TOKEN_TTL_MS } from './common'

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
