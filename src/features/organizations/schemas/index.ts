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

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>
export type OrganizationIdParam = z.infer<typeof organizationIdParamSchema>
