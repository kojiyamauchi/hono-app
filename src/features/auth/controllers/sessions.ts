import type { Context, TypedResponse } from 'hono'

import type { ListDtoType } from '../dtos/sessions'
import type { ItemParamSchemaType } from '../schemas/sessions'
import { sessionsService } from '../services/sessions'

/**
 * auth/sessions のコントローラ。
 */
export const sessionsController = {
  /**
   * 認証済みユーザーのactiveなリフレッシュセッション一覧を返す。
   */
  list: async (c: Context, userId: number): Promise<TypedResponse<ListDtoType, 200, 'json'>> => {
    const sessions = await sessionsService.list(userId)
    return c.json({ sessions }, 200)
  },

  /**
   * 認証済みユーザー自身の指定リフレッシュセッションを失効させる。
   */
  revoke: async (c: Context, userId: number, params: ItemParamSchemaType): Promise<Response> => {
    await sessionsService.revoke(userId, params.id)
    return c.body(null, 204)
  },
}
