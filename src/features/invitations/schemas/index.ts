import { z } from 'zod'

import { tokenSchema } from './common'

/**
 * 招待詳細取得エンドポイントのパスパラメータバリデーションスキーマ。
 * GET /invitations/:token のトークン部分を検証する。
 */
export const tokenParamSchema = z.object({
  token: tokenSchema,
})

export type TokenParamSchemaType = z.infer<typeof tokenParamSchema>
