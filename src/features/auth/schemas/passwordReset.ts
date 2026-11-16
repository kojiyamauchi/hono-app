import { z } from 'zod'

import { emailSchema, passwordSchema, tokenSchema } from './common'

/**
 * パスワードリセット要求入力のバリデーションスキーマ。
 */
export const requestBodySchema = z.object({
  email: emailSchema,
})

/**
 * パスワードリセット確認入力のバリデーションスキーマ。
 */
export const confirmBodySchema = z.object({
  token: tokenSchema,
  password: passwordSchema,
})

export type RequestBodySchemaType = z.infer<typeof requestBodySchema>
export type ConfirmBodySchemaType = z.infer<typeof confirmBodySchema>
