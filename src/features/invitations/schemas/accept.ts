import { z } from 'zod'

import { tokenSchema } from './common'

/**
 * 招待受諾リクエストボディのバリデーションスキーマ。
 * トークンの存在確認はservice層のfindByTokenで行う。
 */
export const bodySchema = z.object({
  token: tokenSchema,
})

export type BodySchemaType = z.infer<typeof bodySchema>
