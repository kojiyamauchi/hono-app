import { z } from 'zod'

import { emailSchema } from './common'

/**
 * ログイン入力のバリデーションスキーマ。
 */
export const bodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'パスワードは必須です'),
})

export type BodySchemaType = z.infer<typeof bodySchema>
