import { z } from 'zod'

import { emailSchema, passwordSchema } from './common'

/**
 * サインアップ入力のバリデーションスキーマ。
 */
export const bodySchema = z.object({
  name: z.string().min(1, '名前は必須です'),
  email: emailSchema,
  password: passwordSchema,
})

export type BodySchemaType = z.infer<typeof bodySchema>
