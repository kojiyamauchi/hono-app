import { z } from 'zod'

/**
 * 招待トークンの入力検証用スキーマ。
 * path parameter・accept・decline・signupのいずれでも同じ条件で検証する。
 * トークンの存在確認はservice層で行う。
 */
export const tokenSchema = z.string().min(1, '招待トークンは必須です')
