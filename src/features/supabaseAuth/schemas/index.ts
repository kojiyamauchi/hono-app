import { z } from '@hono/zod-openapi'

/**
 * Supabase Auth サインアップ入力のバリデーションスキーマ。
 * OpenAPI request bodyとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const signupSchema = z
  .object({
    email: z.email('メールアドレスの形式が正しくありません'),
    password: z.string().min(8, 'パスワードは8文字以上で入力してください'),
  })
  .openapi('SignupRequest')

/**
 * Supabase Auth ログイン入力のバリデーションスキーマ。
 * OpenAPI request bodyとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const loginSchema = z
  .object({
    email: z.email('メールアドレスの形式が正しくありません'),
    password: z.string().min(1, 'パスワードは必須です'),
  })
  .openapi('LoginRequest')

export type SignupSchemaType = z.infer<typeof signupSchema>
export type LoginSchemaType = z.infer<typeof loginSchema>
