import { z } from '@hono/zod-openapi'

import { paginationLimitSchema, rejectBlankNumericQuery } from './common'

/**
 * 組織作成入力のバリデーションスキーマ。
 * OpenAPI request bodyとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const createSchema = z
  .object({
    name: z.string().min(1, '組織名は必須です'),
  })
  .openapi('CreateOrganizationRequest')

/**
 * 組織更新入力のバリデーションスキーマ。
 * OpenAPI request bodyとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const updateSchema = z
  .object({
    name: z.string().min(1, '組織名は必須です'),
  })
  .openapi('UpdateOrganizationRequest')

/**
 * 所属組織一覧（オフセット式）のqueryスキーマ。
 * 未対応の `cursor` を黙って無視せず400とするため、`looseObject` で未知キーを残してrefineで検出する。
 */
export const listMineQuerySchema = z
  .looseObject({
    limit: paginationLimitSchema.openapi({ param: { name: 'limit', in: 'query', required: false }, example: 20 }),
    offset: z
      .preprocess(
        rejectBlankNumericQuery,
        z.coerce
          .number()
          .int('offsetは整数で指定してください')
          .min(0, 'offsetは0以上で指定してください')
          .max(10000, 'offsetは10000以下で指定してください')
          .default(0),
      )
      .openapi({ param: { name: 'offset', in: 'query', required: false }, example: 0 }),
  })
  .refine((value) => value.cursor === undefined, {
    error: '所属組織一覧はオフセット式のため、cursorは指定できません',
    path: ['cursor'],
  })

export type CreateSchemaType = z.infer<typeof createSchema>
export type UpdateSchemaType = z.infer<typeof updateSchema>
export type ListMineQuerySchemaType = z.infer<typeof listMineQuerySchema>
