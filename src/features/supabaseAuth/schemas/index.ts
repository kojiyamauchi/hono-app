import { z } from 'zod'

/**
 * Supabase Auth サインアップ入力のバリデーションスキーマ。
 */
export const signupSchema = z.object({
  email: z.email('メールアドレスの形式が正しくありません'),
  password: z.string().min(8, 'パスワードは8文字以上で入力してください'),
})

/**
 * Supabase Auth ログイン入力のバリデーションスキーマ。
 */
export const loginSchema = z.object({
  email: z.email('メールアドレスの形式が正しくありません'),
  password: z.string().min(1, 'パスワードは必須です'),
})

export type SignupInput = z.infer<typeof signupSchema>
export type LoginInput = z.infer<typeof loginSchema>
