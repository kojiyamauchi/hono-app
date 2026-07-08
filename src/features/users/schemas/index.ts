import { z } from '@hono/zod-openapi'

/**
 * ユーザー更新入力のバリデーションスキーマ。
 * OpenAPI request bodyとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const updateMeSchema = z
  .object({
    name: z.string().min(1, '名前は必須です'),
  })
  .openapi('UpdateMeRequest')

/**
 * ユーザーIDパスパラメータのバリデーションスキーマ。
 * OpenAPI上でpath parameterとして表示するため、`.openapi()` でparamメタデータを付与する。
 */
export const userIdParamSchema = z.object({
  id: z.coerce
    .number()
    .int('ユーザーIDは整数で指定してください')
    .positive('ユーザーIDは1以上で指定してください')
    .openapi({ param: { name: 'id', in: 'path' }, example: 1 }),
})

export type UpdateMeSchemaType = z.infer<typeof updateMeSchema>
export type UserIdParamSchemaType = z.infer<typeof userIdParamSchema>
