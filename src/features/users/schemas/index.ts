import { z } from 'zod'

/**
 * ユーザー更新入力のバリデーションスキーマ。
 */
export const updateMeSchema = z.object({
  name: z.string().min(1, '名前は必須です'),
})

/**
 * ユーザーIDパスパラメータのバリデーションスキーマ。
 */
export const userIdParamSchema = z.object({
  id: z.coerce.number().int('ユーザーIDは整数で指定してください').positive('ユーザーIDは1以上で指定してください'),
})

export type UpdateMeSchemaType = z.infer<typeof updateMeSchema>
export type UserIdParamSchemaType = z.infer<typeof userIdParamSchema>
