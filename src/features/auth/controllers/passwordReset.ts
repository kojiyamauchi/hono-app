import type { Context } from 'hono'

import type { ConfirmBodySchemaType, RequestBodySchemaType } from '../schemas/passwordReset'
import { passwordResetService } from '../services/passwordReset'
import { getClientIp } from './common'

/**
 * auth/password-reset のコントローラ。
 */
export const passwordResetController = {
  /**
   * パスワードリセット要求。
   * 登録有無・通知成否にかかわらず202を返す。
   * IP単位のレート制限超過時のみ429を返す。
   */
  request: async (c: Context, input: RequestBodySchemaType): Promise<Response> => {
    await passwordResetService.request(input.email, getClientIp(c))
    return c.body(null, 202)
  },

  /**
   * パスワードリセット確認。
   * トークン検証・パスワード更新成功時に204を返す。
   */
  confirm: async (c: Context, input: ConfirmBodySchemaType): Promise<Response> => {
    await passwordResetService.confirm(input.token, input.password)
    return c.body(null, 204)
  },
}
