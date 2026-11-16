import { z } from '@hono/zod-openapi'

/**
 * ユーザー更新入力のバリデーションスキーマ。
 * OpenAPI request bodyとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const updateBodySchema = z
  .object({
    name: z.string().min(1, '名前は必須です'),
  })
  .openapi('UpdateMeRequest')

/**
 * アカウント削除時の本人確認入力スキーマ。
 */
export const removeBodySchema = z
  .object({
    currentPassword: z.string().min(1, '現在のパスワードは必須です'),
  })
  .openapi('DeleteMeRequest')

export type UpdateBodySchemaType = z.infer<typeof updateBodySchema>
export type RemoveBodySchemaType = z.infer<typeof removeBodySchema>
