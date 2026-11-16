import { z } from 'zod'

/**
 * メールアドレス入力の共通バリデーションスキーマ。
 */
export const emailSchema = z.email('メールアドレスの形式が正しくありません')

/**
 * 新規に設定するパスワード入力の共通バリデーションスキーマ。
 */
export const passwordSchema = z.string().min(8, 'パスワードは8文字以上で入力してください')

/**
 * パスワードリセット・メールアドレス検証で共通のトークン入力のバリデーションスキーマ。
 */
export const tokenSchema = z.string().min(1, 'トークンは必須です')
