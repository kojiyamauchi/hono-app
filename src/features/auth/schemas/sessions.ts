import { z } from 'zod'

/**
 * リフレッシュセッションIDパラメータのバリデーションスキーマ。
 * idはrefresh token familyIdを表すUUID文字列。
 */
export const itemParamSchema = z.object({
  id: z.uuid('セッションIDの形式が正しくありません'),
})

export type ItemParamSchemaType = z.infer<typeof itemParamSchema>
