import type { Context } from 'hono'

import { clearRefreshTokenCookie } from '@/shared/auth/services/cookie'

import type { BodySchemaType } from '../schemas/changePassword'
import { changePasswordService } from '../services/changePassword'

/**
 * auth/change-password のコントローラ。
 */
export const changePasswordController = {
  /**
   * ログイン済みユーザーのパスワード変更。
   * 成功時は全リフレッシュトークンが失効するため、Cookieをクリアして204を返す。
   */
  execute: async (c: Context, userId: number, input: BodySchemaType): Promise<Response> => {
    await changePasswordService.execute(userId, input.currentPassword, input.newPassword)
    clearRefreshTokenCookie(c)
    return c.body(null, 204)
  },
}
