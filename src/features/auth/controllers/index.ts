import type { Context } from 'hono'

import { clearRefreshTokenCookie, getRefreshTokenCookie, setRefreshTokenCookie } from '@/shared/auth/services'
import { AppError } from '@/utils/errors'

import type { ConfirmPasswordResetSchemaType, LoginSchemaType, RequestPasswordResetSchemaType, SignupSchemaType } from '../schemas'
import { authService } from '../services'

/**
 * レート制限に使うクライアントIPを取得する。
 * x-forwarded-for は信頼できるプロキシ/CDN背後でのみ信頼する前提とし、複数値の場合は先頭を使う。
 * IPを特定できない場合は、全クライアントを同じキーへ束ねないようundefinedを返す。
 */
const getClientIp = (c: Context): string | undefined => {
  const forwardedFor = c.req.header('x-forwarded-for')
  const forwardedIp = forwardedFor?.split(',')[0]?.trim()
  if (forwardedIp) {
    return forwardedIp
  }

  const realIp = c.req.header('x-real-ip')?.trim()
  if (realIp) {
    return realIp
  }

  return undefined
}

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

  /**
   * パスワードリセット要求。
   * 登録有無・通知成否にかかわらず202を返す。
   * IP単位のレート制限超過時のみ429を返す。
   */
  requestPasswordReset: async (c: Context, input: RequestPasswordResetSchemaType): Promise<Response> => {
    await authService.requestPasswordReset(input.email, getClientIp(c))
    return c.body(null, 202)
  },

  /**
   * パスワードリセット確認。
   * トークン検証・パスワード更新成功時に204を返す。
   */
  confirmPasswordReset: async (c: Context, input: ConfirmPasswordResetSchemaType): Promise<Response> => {
    await authService.confirmPasswordReset(input.token, input.password)
    return c.body(null, 204)
  },
}
