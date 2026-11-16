import { z } from '@hono/zod-openapi'

import { cursorCreatedAtSchema, paginationLimitSchema, POSTGRES_INT_MAX } from './common'

/**
 * 監査ログ一覧専用の組織IDパスパラメータのバリデーションスキーマ。
 * 形式は `common.ts` の `idParamSchema` と同じだが、PostgreSQL INTEGERの上限（2147483647）も検証する。
 * 上限を超える組織IDが所属確認のDBクエリへ渡って500になることを防ぐ。
 * OpenAPI上でpath parameterとして表示するため、`.openapi()` でparamメタデータを付与する。
 */
export const collectionParamSchema = z.object({
  id: z.coerce
    .number()
    .int('組織IDは整数で指定してください')
    .positive('組織IDは1以上で指定してください')
    .max(POSTGRES_INT_MAX, `組織IDは${POSTGRES_INT_MAX}以下で指定してください`)
    .openapi({ param: { name: 'id', in: 'path' }, example: 1 }),
})

/**
 * 監査ログ一覧（カーソル式）のqueryスキーマ。形はメンバー一覧と同じ。
 * 未対応の `offset` を黙って無視せず400とするため、`looseObject` で未知キーを残してrefineで検出する。
 * OpenAPIのquery parameterにはshapeに書いたキー（limit・cursor）だけが出力される。
 */
export const listQuerySchema = z
  .looseObject({
    limit: paginationLimitSchema.openapi({ param: { name: 'limit', in: 'query', required: false }, example: 20 }),
    cursor: z
      .string()
      .min(1, 'cursorは空文字では指定できません')
      .optional()
      .openapi({ param: { name: 'cursor', in: 'query', required: false } }),
  })
  .refine((value) => value.offset === undefined, {
    error: '監査ログ一覧はカーソル式のため、offsetは指定できません',
    path: ['offset'],
  })

/** 監査ログカーソルのペイロード形式のバージョン。形式を変える場合はここを上げ、旧カーソルを不正として扱う。 */
export const AUDIT_LOG_CURSOR_VERSION = 1

/** 監査ログカーソルの種別。メンバー一覧など、同じ形の別APIのカーソルを識別するために必須とする。 */
export const AUDIT_LOG_CURSOR_KIND = 'auditLogs'

/**
 * 監査ログカーソルのデコード後ペイロードのスキーマ。
 * `kind` を必須にするため、`kind` を持たないメンバー一覧のカーソルは監査ログAPIで不正になる。
 * 受信値は信用せず、種別・バージョン・対象組織・境界値の形式をここで検証する。
 * `organizationId` と `id` はDBへバインドされるため、PostgreSQL INTEGERの上限も検証する（超過は500になるため）。
 */
export const cursorPayloadSchema = z.object({
  kind: z.literal(AUDIT_LOG_CURSOR_KIND),
  version: z.literal(AUDIT_LOG_CURSOR_VERSION),
  organizationId: z.number().int().positive().max(POSTGRES_INT_MAX),
  createdAt: cursorCreatedAtSchema,
  id: z.number().int().positive().max(POSTGRES_INT_MAX),
})

export type CollectionParamSchemaType = z.infer<typeof collectionParamSchema>
export type ListQuerySchemaType = z.infer<typeof listQuerySchema>
export type CursorPayloadSchemaType = z.infer<typeof cursorPayloadSchema>
