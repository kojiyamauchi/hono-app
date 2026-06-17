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

/**
 * 招待経由サインアップリクエストボディのバリデーションスキーマ。
 * メールアドレスは招待情報のemailを使用するため、リクエストbodyでは受け取らない。
 */
export const signupInvitationBodySchema = z.object({
  token: z.string().min(1, '招待トークンは必須です'),
  name: z.string().min(1, '名前は必須です'),
  password: z.string().min(8, 'パスワードは8文字以上で入力してください'),
})

export type SignupInvitationBodySchemaType = z.infer<typeof signupInvitationBodySchema>
