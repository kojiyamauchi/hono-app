import { z } from '@hono/zod-openapi'

/**
 * Supabase Auth ログイン入力のバリデーションスキーマ。
 * OpenAPI request bodyとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const bodySchema = z
  .object({
    email: z.email('メールアドレスの形式が正しくありません'),
    password: z.string().min(1, 'パスワードは必須です'),
  })
  .openapi('LoginRequest')

export type BodySchemaType = z.infer<typeof bodySchema>
