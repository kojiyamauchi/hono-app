import type { Context } from 'hono'

import type { BodySchemaType } from '../schemas/decline'
import { declineService } from '../services/decline'

/**
 * 招待辞退のコントローラ。
 * 無内容応答（204）を返すため、`TypedResponse<null, 204, 'body'>` が openapi() の
 * 要求する型へ代入できないことから、素直に `Response` を返す型にする。
 */
export const declineController = {
  /**
   * 招待を辞退する。204 No Contentを返す。
   */
  execute: async (c: Context, input: BodySchemaType): Promise<Response> => {
    await declineService.execute(input.token)
    return c.body(null, 204)
  },
}
