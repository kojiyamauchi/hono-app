import { z } from '@hono/zod-openapi'

import { roleValues } from '@/shared/membership/entities'

/**
 * 組織作成入力のバリデーションスキーマ。
 * OpenAPI request bodyとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const createOrganizationSchema = z
  .object({
    name: z.string().min(1, '組織名は必須です'),
  })
  .openapi('CreateOrganizationRequest')

/**
 * 組織更新入力のバリデーションスキーマ。
 * OpenAPI request bodyとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const updateOrganizationSchema = z
  .object({
    name: z.string().min(1, '組織名は必須です'),
  })
  .openapi('UpdateOrganizationRequest')

/**
 * 組織IDパスパラメータのバリデーションスキーマ。
 * OpenAPI上でpath parameterとして表示するため、`.openapi()` でparamメタデータを付与する。
 */
export const organizationIdParamSchema = z.object({
  id: z.coerce
    .number()
    .int('組織IDは整数で指定してください')
    .positive('組織IDは1以上で指定してください')
    .openapi({ param: { name: 'id', in: 'path' }, example: 1 }),
})

/**
 * メンバー追加ボディのバリデーションスキーマ。
 * 形式チェックはここで行い、OWNERの意味的バリデーション（422）はservice層で行う。
 * OpenAPI request bodyとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const addMemberBodySchema = z
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
export const updateMemberRoleBodySchema = z
  .object({
    role: z.enum(roleValues, { error: 'ロールはMEMBER、ADMIN、OWNERのいずれかを指定してください' }),
  })
  .openapi('UpdateMemberRoleRequest')

/**
 * 所有権移譲ボディのバリデーションスキーマ。
 * OpenAPI request bodyとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const transferOwnershipBodySchema = z
  .object({
    membershipId: z.number().int('メンバーシップIDは整数で指定してください').positive('メンバーシップIDは1以上で指定してください'),
  })
  .openapi('TransferOrganizationOwnershipRequest')

/**
 * 組織IDとメンバーシップIDを含むパスパラメータのバリデーションスキーマ。
 * OpenAPI上でpath parameterとして表示するため、`.openapi()` でparamメタデータを付与する。
 */
export const memberRouteParamSchema = z.object({
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
 * 招待作成ボディのバリデーションスキーマ。
 * roleはMEMBERまたはADMINのみ指定可（OWNER指定は422はservice層で行う）。
 * OpenAPI request bodyとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const createInvitationBodySchema = z
  .object({
    email: z.email('メールアドレスの形式が正しくありません'),
    role: z.enum(roleValues, { error: 'ロールはMEMBER、ADMIN、OWNERのいずれかを指定してください' }),
  })
  .openapi('CreateInvitationRequest')

/**
 * 組織IDと招待IDを含むパスパラメータのバリデーションスキーマ。
 * OpenAPI上でpath parameterとして表示するため、`.openapi()` でparamメタデータを付与する。
 */
export const invitationRouteParamSchema = z.object({
  id: z.coerce
    .number()
    .int('組織IDは整数で指定してください')
    .positive('組織IDは1以上で指定してください')
    .openapi({ param: { name: 'id', in: 'path' }, example: 1 }),
  invitationId: z.coerce
    .number()
    .int('招待IDは整数で指定してください')
    .positive('招待IDは1以上で指定してください')
    .openapi({ param: { name: 'invitationId', in: 'path' }, example: 1 }),
})

/** ページネーション共通のlimit。省略時20、1〜100の整数。 */
const paginationLimitSchema = z.coerce
  .number()
  .int('limitは整数で指定してください')
  .min(1, 'limitは1以上で指定してください')
  .max(100, 'limitは100以下で指定してください')
  .default(20)

/**
 * メンバー一覧（カーソル式）のqueryスキーマ。
 * 未対応の `offset` を黙って無視せず400とするため、`looseObject` で未知キーを残してrefineで検出する。
 * OpenAPIのquery parameterにはshapeに書いたキー（limit・cursor）だけが出力される。
 */
export const listMembersQuerySchema = z
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

/**
 * 所属組織一覧（オフセット式）のqueryスキーマ。
 * 未対応の `cursor` を黙って無視せず400とするため、`looseObject` で未知キーを残してrefineで検出する。
 */
export const listMineQuerySchema = z
  .looseObject({
    limit: paginationLimitSchema.openapi({ param: { name: 'limit', in: 'query', required: false }, example: 20 }),
    offset: z.coerce
      .number()
      .int('offsetは整数で指定してください')
      .min(0, 'offsetは0以上で指定してください')
      .max(10000, 'offsetは10000以下で指定してください')
      .default(0)
      .openapi({ param: { name: 'offset', in: 'query', required: false }, example: 0 }),
  })
  .refine((value) => value.cursor === undefined, {
    error: '所属組織一覧はオフセット式のため、cursorは指定できません',
    path: ['cursor'],
  })

/**
 * メンバー一覧カーソルのデコード後ペイロードのスキーマ。
 * 受信値は信用せず、バージョン・対象組織・境界値の形式をここで検証する。
 */
export const memberListCursorPayloadSchema = z.object({
  version: z.literal(1),
  organizationId: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  id: z.number().int().positive(),
})

export type CreateOrganizationSchemaType = z.infer<typeof createOrganizationSchema>
export type UpdateOrganizationSchemaType = z.infer<typeof updateOrganizationSchema>
export type OrganizationIdParamSchemaType = z.infer<typeof organizationIdParamSchema>
export type AddMemberBodySchemaType = z.infer<typeof addMemberBodySchema>
export type UpdateMemberRoleBodySchemaType = z.infer<typeof updateMemberRoleBodySchema>
export type TransferOwnershipBodySchemaType = z.infer<typeof transferOwnershipBodySchema>
export type MemberRouteParamSchemaType = z.infer<typeof memberRouteParamSchema>
export type CreateInvitationBodySchemaType = z.infer<typeof createInvitationBodySchema>
export type InvitationRouteParamSchemaType = z.infer<typeof invitationRouteParamSchema>
export type ListMembersQuerySchemaType = z.infer<typeof listMembersQuerySchema>
export type ListMineQuerySchemaType = z.infer<typeof listMineQuerySchema>
export type MemberListCursorPayloadSchemaType = z.infer<typeof memberListCursorPayloadSchema>
