import { z } from '@hono/zod-openapi'

/**
 * Supabase Auth サインアップ入力のバリデーションスキーマ。
 * OpenAPI request bodyとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const bodySchema = z
  .object({
    email: z.email('メールアドレスの形式が正しくありません'),
    password: z.string().min(8, 'パスワードは8文字以上で入力してください'),
  })
  .openapi('SignupRequest')

export type BodySchemaType = z.infer<typeof bodySchema>
