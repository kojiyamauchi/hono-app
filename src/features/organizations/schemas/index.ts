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

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>
export type OrganizationIdParam = z.infer<typeof organizationIdParamSchema>
export type AddMemberBodyInput = z.infer<typeof addMemberBodySchema>
export type UpdateMemberRoleBodyInput = z.infer<typeof updateMemberRoleBodySchema>
export type MemberRouteParam = z.infer<typeof memberRouteParamSchema>
