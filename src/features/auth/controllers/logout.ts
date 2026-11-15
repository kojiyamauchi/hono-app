import type { Context } from 'hono'

import { clearRefreshTokenCookie, getRefreshTokenCookie } from '@/shared/auth/services/cookie'

import { logoutService } from '../services/logout'

/**
 * auth/logout のコントローラ。
 * 無内容応答（204）は `TypedResponse<null, 204, 'body'>` が openapi() の要求する型へ代入できないため、素直に `Response` を返す型にする。
 */
export const logoutController = {
  /**
   * Cookieからリフレッシュトークンを取得してfamilyを失効し、CookieをクリアしてNoContent 204を返す。
   * Cookie無しでも204を返す（冪等）。
   */
  execute: async (c: Context): Promise<Response> => {
    const cookieToken = getRefreshTokenCookie(c)
    if (cookieToken) {
      await logoutService.execute(cookieToken)
    }
    clearRefreshTokenCookie(c)
    return c.body(null, 204)
  },
}
