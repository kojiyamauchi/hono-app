import { z } from '@hono/zod-openapi'

/**
 * 所有権移譲ボディのバリデーションスキーマ。
 * OpenAPI request bodyとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const bodySchema = z
  .object({
    membershipId: z.number().int('メンバーシップIDは整数で指定してください').positive('メンバーシップIDは1以上で指定してください'),
  })
  .openapi('TransferOrganizationOwnershipRequest')

export type BodySchemaType = z.infer<typeof bodySchema>
