import type { Context } from 'hono'

import { clearRefreshTokenCookie, getRefreshTokenCookie, setRefreshTokenCookie } from '@/shared/auth/services'
import { AppError } from '@/utils/errors'

import type { LoginSchemaType, SignupSchemaType } from '../schemas'
import { authService } from '../services'

/**
 * 認証エンドポイントのコントローラ。
 * バリデーション済みの入力を受け取り、serviceを呼び出してレスポンスを返す。
 * リフレッシュトークンはHttpOnly CookieとしてセットしbodyにはAuthResultのみ返す。
 */
export const authController = {
  /**
   * サインアップ。201でアクセストークンとユーザー情報を返す。
   * リフレッシュトークンはCookieへセットする。
   */
  signup: async (c: Context, input: SignupSchemaType): Promise<Response> => {
    const result = await authService.signup(input)
    setRefreshTokenCookie(c, result.refreshToken)
    return c.json({ token: result.token, user: result.user }, 201)
  },

  /**
   * ログイン。200でアクセストークンとユーザー情報を返す。
   * リフレッシュトークンはCookieへセットする。
   */
  login: async (c: Context, input: LoginSchemaType): Promise<Response> => {
    const result = await authService.login(input)
    setRefreshTokenCookie(c, result.refreshToken)
    return c.json({ token: result.token, user: result.user }, 200)
  },

  /**
   * Cookieからリフレッシュトークンを取得してローテーションし、200で新しいアクセストークンを返す。
   * Cookieが存在しない場合は401。
   */
  refresh: async (c: Context): Promise<Response> => {
    const cookieToken = getRefreshTokenCookie(c)
    if (!cookieToken) {
      throw new AppError(401, 'リフレッシュトークンが見つかりません')
    }
    const result = await authService.refresh(cookieToken)
    setRefreshTokenCookie(c, result.refreshToken)
    return c.json({ token: result.token, user: result.user }, 200)
  },

  /**
   * Cookieからリフレッシュトークンを取得してfamilyを失効し、CookieをクリアしてNoContent 204を返す。
   * Cookie無しでも204を返す（冪等）。
   */
  logout: async (c: Context): Promise<Response> => {
    const cookieToken = getRefreshTokenCookie(c)
    if (cookieToken) {
      await authService.logout(cookieToken)
    }
    clearRefreshTokenCookie(c)
    return c.body(null, 204)
  },

  /**
   * 認証済みユーザー自身の情報を返す。
   */
  me: async (c: Context, userId: number): Promise<Response> => {
    const user = await authService.getById(userId)
    return c.json(user, 200)
  },
}
