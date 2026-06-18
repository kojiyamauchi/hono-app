import { z } from 'zod'

/**
 * サインアップ入力のバリデーションスキーマ。
 */
export const signupSchema = z.object({
  name: z.string().min(1, '名前は必須です'),
  email: z.email('メールアドレスの形式が正しくありません'),
  password: z.string().min(8, 'パスワードは8文字以上で入力してください'),
})

/**
 * ログイン入力のバリデーションスキーマ。
 */
export const loginSchema = z.object({
  email: z.email('メールアドレスの形式が正しくありません'),
  password: z.string().min(1, 'パスワードは必須です'),
})

/**
 * リフレッシュトークン入力のバリデーションスキーマ。
 */
export const refreshTokenBodySchema = z.object({
  refreshToken: z.string().min(1, 'リフレッシュトークンは必須です'),
})

export type SignupSchemaType = z.infer<typeof signupSchema>
export type LoginSchemaType = z.infer<typeof loginSchema>
export type RefreshTokenBodySchemaType = z.infer<typeof refreshTokenBodySchema>
