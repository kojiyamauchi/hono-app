import type { Context, TypedResponse } from 'hono'

import type { PublicUserDtoType } from '@/shared/user/dtos'

import { service } from '../services'

/**
 * users feature本体（`/users/{id}`）のコントローラ。
 * 返り値は OpenAPIHono の `openapi()` ハンドラが要求する型付きレスポンス（`TypedResponse`）を維持する。
 * これにより createRoute の responses 定義と実際の返り値が型レベルで整合する。
 */
export const controller = {
  /**
   * 指定IDのユーザー公開情報を返す。
   */
  getById: async (c: Context, id: number): Promise<TypedResponse<PublicUserDtoType, 200, 'json'>> => {
    const user = await service.getById(id)
    return c.json(user, 200)
  },
}
