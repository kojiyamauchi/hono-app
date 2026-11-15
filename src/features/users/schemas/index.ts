import { z } from '@hono/zod-openapi'

/**
 * ユーザーIDパスパラメータのバリデーションスキーマ。
 * OpenAPI上でpath parameterとして表示するため、`.openapi()` でparamメタデータを付与する。
 */
export const idParamSchema = z.object({
  id: z.coerce
    .number()
    .int('ユーザーIDは整数で指定してください')
    .positive('ユーザーIDは1以上で指定してください')
    .openapi({ param: { name: 'id', in: 'path' }, example: 1 }),
})

export type IdParamSchemaType = z.infer<typeof idParamSchema>
