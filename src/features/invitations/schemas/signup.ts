import { z } from 'zod'

import { tokenSchema } from './common'

/**
 * 招待経由サインアップリクエストボディのバリデーションスキーマ。
 * メールアドレスは招待情報のemailを使用するため、リクエストbodyでは受け取らない。
 */
export const bodySchema = z.object({
  token: tokenSchema,
  name: z.string().min(1, '名前は必須です'),
  password: z.string().min(8, 'パスワードは8文字以上で入力してください'),
})

export type BodySchemaType = z.infer<typeof bodySchema>
