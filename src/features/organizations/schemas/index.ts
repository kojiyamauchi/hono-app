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

export type CreateOrganizationSchemaType = z.infer<typeof createOrganizationSchema>
export type UpdateOrganizationSchemaType = z.infer<typeof updateOrganizationSchema>
export type OrganizationIdParamSchemaType = z.infer<typeof organizationIdParamSchema>
export type AddMemberBodySchemaType = z.infer<typeof addMemberBodySchema>
export type UpdateMemberRoleBodySchemaType = z.infer<typeof updateMemberRoleBodySchema>
export type MemberRouteParamSchemaType = z.infer<typeof memberRouteParamSchema>
export type CreateInvitationBodySchemaType = z.infer<typeof createInvitationBodySchema>
export type InvitationRouteParamSchemaType = z.infer<typeof invitationRouteParamSchema>
