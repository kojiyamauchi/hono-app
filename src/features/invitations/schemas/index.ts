import { z } from 'zod'

/**
 * 招待受諾リクエストボディのバリデーションスキーマ。
 * トークンの存在確認はservice層のfindByTokenで行う。
 */
export const acceptInvitationBodySchema = z.object({
  token: z.string().min(1, '招待トークンは必須です'),
})

export type AcceptInvitationBodySchemaType = z.infer<typeof acceptInvitationBodySchema>

/**
 * 招待辞退リクエストボディのバリデーションスキーマ。
 * トークンの存在確認はservice層のfindByTokenで行う。
 */
export const declineInvitationBodySchema = z.object({
  token: z.string().min(1, '招待トークンは必須です'),
})

export type DeclineInvitationBodySchemaType = z.infer<typeof declineInvitationBodySchema>
