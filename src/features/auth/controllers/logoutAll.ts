import type { Context } from 'hono'

import { clearRefreshTokenCookie } from '@/shared/auth/services'

import { logoutAllService } from '../services/logoutAll'

/**
 * auth/logout-all のコントローラ。
 */
export const logoutAllController = {
  /**
   * ログイン済みユーザーの全リフレッシュセッションを失効させる。
   * 成功時はrefresh cookieをクリアして204を返す。
   */
  execute: async (c: Context, userId: number): Promise<Response> => {
    await logoutAllService.execute(userId)
    clearRefreshTokenCookie(c)
    return c.body(null, 204)
  },
}
