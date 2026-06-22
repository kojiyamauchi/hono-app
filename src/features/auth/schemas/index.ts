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
 * パスワードリセット要求入力のバリデーションスキーマ。
 */
export const requestPasswordResetSchema = z.object({
  email: z.email('メールアドレスの形式が正しくありません'),
})

/**
 * パスワードリセット確認入力のバリデーションスキーマ。
 */
export const confirmPasswordResetSchema = z.object({
  token: z.string().min(1, 'トークンは必須です'),
  password: z.string().min(8, 'パスワードは8文字以上で入力してください'),
})

export type SignupSchemaType = z.infer<typeof signupSchema>
export type LoginSchemaType = z.infer<typeof loginSchema>
export type RequestPasswordResetSchemaType = z.infer<typeof requestPasswordResetSchema>
export type ConfirmPasswordResetSchemaType = z.infer<typeof confirmPasswordResetSchema>
