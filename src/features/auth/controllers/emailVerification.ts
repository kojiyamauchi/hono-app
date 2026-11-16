import type { Context } from 'hono'

import type { ConfirmBodySchemaType } from '../schemas/emailVerification'
import { emailVerificationService } from '../services/emailVerification'

/**
 * auth/email-verification のコントローラ。
 */
export const emailVerificationController = {
  /**
   * 認証済みユーザーへメールアドレス検証メールを再送し、202を返す。
   */
  request: async (c: Context, userId: number): Promise<Response> => {
    await emailVerificationService.request(userId)
    return c.body(null, 202)
  },

  /**
   * メールアドレス検証トークンを確認し、204を返す。
   */
  confirm: async (c: Context, input: ConfirmBodySchemaType): Promise<Response> => {
    await emailVerificationService.confirm(input.token)
    return c.body(null, 204)
  },
}
