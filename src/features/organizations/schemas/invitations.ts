import { z } from '@hono/zod-openapi'

import { roleValues } from '@/shared/membership/entities'

/**
 * 招待作成ボディのバリデーションスキーマ。
 * roleはMEMBERまたはADMINのみ指定可（OWNER指定は422はservice層で行う）。
 * OpenAPI request bodyとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const createBodySchema = z
  .object({
    email: z.email('メールアドレスの形式が正しくありません'),
    role: z.enum(roleValues, { error: 'ロールはMEMBER、ADMIN、OWNERのいずれかを指定してください' }),
  })
  .openapi('CreateInvitationRequest')

/**
 * 組織IDと招待IDを含むパスパラメータのバリデーションスキーマ。
 * OpenAPI上でpath parameterとして表示するため、`.openapi()` でparamメタデータを付与する。
 */
export const itemParamSchema = z.object({
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

export type CreateBodySchemaType = z.infer<typeof createBodySchema>
export type ItemParamSchemaType = z.infer<typeof itemParamSchema>
