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
 * PostgreSQLのINTEGER（int4）の上限値。
 * IDカラムはINTEGERのため、これを超える値をDBへ渡すと整数変換に失敗して500になる。
 * 外部入力のIDをDBへ渡す前に、この値以下へ制限して400にするために使う。
 */
export const POSTGRES_INT_MAX = 2147483647

/**
 * 監査ログ一覧専用の組織IDパスパラメータのバリデーションスキーマ。
 * 形式は `organizationIdParamSchema` と同じだが、PostgreSQL INTEGERの上限（2147483647）も検証する。
 * 上限を超える組織IDが所属確認のDBクエリへ渡って500になることを防ぐ。
 * OpenAPI上でpath parameterとして表示するため、`.openapi()` でparamメタデータを付与する。
 */
export const auditLogsRouteParamSchema = z.object({
  id: z.coerce
    .number()
    .int('組織IDは整数で指定してください')
    .positive('組織IDは1以上で指定してください')
    .max(POSTGRES_INT_MAX, `組織IDは${POSTGRES_INT_MAX}以下で指定してください`)
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

/**
 * ページネーションの数値queryを `z.coerce.number()` へ渡す前の前処理。
 * `Number('')` と `Number(' ')` と `Number(null)` はいずれも0になるため、
 * 明示された空文字・空白・nullが既定値や0として通ってしまう（`offset=` が200で先頭ページになる）。
 * 未指定（`undefined`）だけを `.default()` へ委ね、それ以外はNaNへ寄せて400にする。
 */
const rejectBlankNumericQuery = (value: unknown): unknown => (value === null || (typeof value === 'string' && value.trim() === '') ? Number.NaN : value)

/** ページネーション共通のlimit。省略時20、1〜100の整数。プロジェクト一覧のschemaからも再利用するためexportする。 */
export const paginationLimitSchema = z.preprocess(
  rejectBlankNumericQuery,
  z.coerce.number().int('limitは整数で指定してください').min(1, 'limitは1以上で指定してください').max(100, 'limitは100以下で指定してください').default(20),
)

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

/**
 * 監査ログ一覧（カーソル式）のqueryスキーマ。形はメンバー一覧と同じ。
 * 未対応の `offset` を黙って無視せず400とするため、`looseObject` で未知キーを残してrefineで検出する。
 * OpenAPIのquery parameterにはshapeに書いたキー（limit・cursor）だけが出力される。
 */
export const listAuditLogsQuerySchema = z
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

/**
 * カーソルの境界日時のスキーマ（メンバー一覧・監査ログ一覧・プロジェクト一覧で共通。projects側からも参照するためexportする）。
 * `z.iso.datetime()` は4桁年を許容するため0年（`0000-01-01T00:00:00.000Z`）も通る。
 * PostgreSQLに0年は存在せず、Dateとしてバインドすると `22008 date/time field value out of range` で
 * 500になる。カーソルはクライアントが改変できる入力のため、DBへ渡す前にここで弾いて400にする。
 */
export const cursorCreatedAtSchema = z.iso.datetime().refine((value) => new Date(value).getUTCFullYear() >= 1, { error: 'カーソルの日時が範囲外です' })

/** メンバー一覧カーソルのペイロード形式のバージョン。形式を変える場合はここを上げ、旧カーソルを不正として扱う。 */
export const MEMBER_LIST_CURSOR_VERSION = 1

/**
 * メンバー一覧カーソルのデコード後ペイロードのスキーマ。
 * 受信値は信用せず、バージョン・対象組織・境界値の形式をここで検証する。
 */
export const memberListCursorPayloadSchema = z.object({
  version: z.literal(MEMBER_LIST_CURSOR_VERSION),
  organizationId: z.number().int().positive(),
  createdAt: cursorCreatedAtSchema,
  id: z.number().int().positive(),
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
export const auditLogCursorPayloadSchema = z.object({
  kind: z.literal(AUDIT_LOG_CURSOR_KIND),
  version: z.literal(AUDIT_LOG_CURSOR_VERSION),
  organizationId: z.number().int().positive().max(POSTGRES_INT_MAX),
  createdAt: cursorCreatedAtSchema,
  id: z.number().int().positive().max(POSTGRES_INT_MAX),
})

export type CreateOrganizationSchemaType = z.infer<typeof createOrganizationSchema>
export type UpdateOrganizationSchemaType = z.infer<typeof updateOrganizationSchema>
export type OrganizationIdParamSchemaType = z.infer<typeof organizationIdParamSchema>
export type AuditLogsRouteParamSchemaType = z.infer<typeof auditLogsRouteParamSchema>
export type AddMemberBodySchemaType = z.infer<typeof addMemberBodySchema>
export type UpdateMemberRoleBodySchemaType = z.infer<typeof updateMemberRoleBodySchema>
export type TransferOwnershipBodySchemaType = z.infer<typeof transferOwnershipBodySchema>
export type MemberRouteParamSchemaType = z.infer<typeof memberRouteParamSchema>
export type CreateInvitationBodySchemaType = z.infer<typeof createInvitationBodySchema>
export type InvitationRouteParamSchemaType = z.infer<typeof invitationRouteParamSchema>
export type ListMembersQuerySchemaType = z.infer<typeof listMembersQuerySchema>
export type ListMineQuerySchemaType = z.infer<typeof listMineQuerySchema>
export type ListAuditLogsQuerySchemaType = z.infer<typeof listAuditLogsQuerySchema>
export type MemberListCursorPayloadSchemaType = z.infer<typeof memberListCursorPayloadSchema>
export type AuditLogCursorPayloadSchemaType = z.infer<typeof auditLogCursorPayloadSchema>
