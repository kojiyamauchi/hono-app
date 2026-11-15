import { z } from '@hono/zod-openapi'

import { roleValues } from '@/shared/membership/entities'

import { cursorCreatedAtSchema, paginationLimitSchema } from './common'

/**
 * メンバー追加ボディのバリデーションスキーマ。
 * 形式チェックはここで行い、OWNERの意味的バリデーション（422）はservice層で行う。
 * OpenAPI request bodyとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const addBodySchema = z
  .object({
    email: z.email('メールアドレスの形式が正しくありません'),
    role: z.enum(roleValues, { error: 'ロールはMEMBER、ADMIN、OWNERのいずれかを指定してください' }),
  })
  .openapi('AddMemberRequest')

/**
 * メンバーロール変更ボディのバリデーションスキーマ。
 * 形式チェックはここで行い、OWNERの意味的バリデーション（422）はservice層で行う。
 * OpenAPI request bodyとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const updateRoleBodySchema = z
  .object({
    role: z.enum(roleValues, { error: 'ロールはMEMBER、ADMIN、OWNERのいずれかを指定してください' }),
  })
  .openapi('UpdateMemberRoleRequest')

/**
 * 組織IDとメンバーシップIDを含むパスパラメータのバリデーションスキーマ。
 * OpenAPI上でpath parameterとして表示するため、`.openapi()` でparamメタデータを付与する。
 */
export const itemParamSchema = z.object({
  id: z.coerce
    .number()
    .int('組織IDは整数で指定してください')
    .positive('組織IDは1以上で指定してください')
    .openapi({ param: { name: 'id', in: 'path' }, example: 1 }),
  membershipId: z.coerce
    .number()
    .int('メンバーシップIDは整数で指定してください')
    .positive('メンバーシップIDは1以上で指定してください')
    .openapi({ param: { name: 'membershipId', in: 'path' }, example: 1 }),
})

/**
 * メンバー一覧（カーソル式）のqueryスキーマ。
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
    error: 'メンバー一覧はカーソル式のため、offsetは指定できません',
    path: ['offset'],
  })

/** メンバー一覧カーソルのペイロード形式のバージョン。形式を変える場合はここを上げ、旧カーソルを不正として扱う。 */
export const MEMBER_LIST_CURSOR_VERSION = 1

/**
 * メンバー一覧カーソルのデコード後ペイロードのスキーマ。
 * 受信値は信用せず、バージョン・対象組織・境界値の形式をここで検証する。
 */
export const cursorPayloadSchema = z.object({
  version: z.literal(MEMBER_LIST_CURSOR_VERSION),
  organizationId: z.number().int().positive(),
  createdAt: cursorCreatedAtSchema,
  id: z.number().int().positive(),
})

export type AddBodySchemaType = z.infer<typeof addBodySchema>
export type UpdateRoleBodySchemaType = z.infer<typeof updateRoleBodySchema>
export type ItemParamSchemaType = z.infer<typeof itemParamSchema>
export type ListQuerySchemaType = z.infer<typeof listQuerySchema>
export type CursorPayloadSchemaType = z.infer<typeof cursorPayloadSchema>
