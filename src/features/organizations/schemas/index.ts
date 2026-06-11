import { z } from 'zod'

/**
 * 組織作成入力のバリデーションスキーマ。
 */
export const createOrganizationSchema = z.object({
  name: z.string().min(1, '組織名は必須です'),
})

/**
 * 組織更新入力のバリデーションスキーマ。
 */
export const updateOrganizationSchema = z.object({
  name: z.string().min(1, '組織名は必須です'),
})

/**
 * 組織IDパスパラメータのバリデーションスキーマ。
 */
export const organizationIdParamSchema = z.object({
  id: z.coerce.number().int('組織IDは整数で指定してください').positive('組織IDは1以上で指定してください'),
})

/**
 * メンバー追加ボディのバリデーションスキーマ。
 * 形式チェックはここで行い、OWNERの意味的バリデーション（422）はservice層で行う。
 */
export const addMemberBodySchema = z.object({
  email: z.string().email('メールアドレスの形式が正しくありません'),
  role: z.enum(['MEMBER', 'ADMIN', 'OWNER'], { message: 'ロールはMEMBER、ADMIN、OWNERのいずれかを指定してください' }),
})

/**
 * メンバーロール変更ボディのバリデーションスキーマ。
 * 形式チェックはここで行い、OWNERの意味的バリデーション（422）はservice層で行う。
 */
export const updateMemberRoleBodySchema = z.object({
  role: z.enum(['MEMBER', 'ADMIN', 'OWNER'], { message: 'ロールはMEMBER、ADMIN、OWNERのいずれかを指定してください' }),
})

/**
 * 組織IDとメンバーシップIDを含むパスパラメータのバリデーションスキーマ。
 */
export const memberRouteParamSchema = z.object({
  id: z.coerce.number().int('組織IDは整数で指定してください').positive('組織IDは1以上で指定してください'),
  membershipId: z.coerce.number().int('メンバーシップIDは整数で指定してください').positive('メンバーシップIDは1以上で指定してください'),
})

/**
 * 招待作成ボディのバリデーションスキーマ。
 * roleはMEMBERまたはADMINのみ指定可（OWNER指定は422はservice層で行う）。
 */
export const createInvitationBodySchema = z.object({
  email: z.string().email('メールアドレスの形式が正しくありません'),
  role: z.enum(['MEMBER', 'ADMIN', 'OWNER'], { message: 'ロールはMEMBER、ADMIN、OWNERのいずれかを指定してください' }),
})

/**
 * 組織IDと招待IDを含むパスパラメータのバリデーションスキーマ。
 */
export const invitationRouteParamSchema = z.object({
  id: z.coerce.number().int('組織IDは整数で指定してください').positive('組織IDは1以上で指定してください'),
  invitationId: z.coerce.number().int('招待IDは整数で指定してください').positive('招待IDは1以上で指定してください'),
})

export type CreateOrganizationSchemaType = z.infer<typeof createOrganizationSchema>
export type UpdateOrganizationSchemaType = z.infer<typeof updateOrganizationSchema>
export type OrganizationIdParamSchemaType = z.infer<typeof organizationIdParamSchema>
export type AddMemberBodySchemaType = z.infer<typeof addMemberBodySchema>
export type UpdateMemberRoleBodySchemaType = z.infer<typeof updateMemberRoleBodySchema>
export type MemberRouteParamSchemaType = z.infer<typeof memberRouteParamSchema>
export type CreateInvitationBodySchemaType = z.infer<typeof createInvitationBodySchema>
export type InvitationRouteParamSchemaType = z.infer<typeof invitationRouteParamSchema>
