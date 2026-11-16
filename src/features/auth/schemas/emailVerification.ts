import { z } from 'zod'

import { tokenSchema } from './common'

/**
 * メールアドレス検証確認入力のバリデーションスキーマ。
 */
export const confirmBodySchema = z.object({
  token: tokenSchema,
})

export type ConfirmBodySchemaType = z.infer<typeof confirmBodySchema>
