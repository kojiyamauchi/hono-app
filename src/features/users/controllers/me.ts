import type { Context, TypedResponse } from 'hono'

import { clearRefreshTokenCookie } from '@/shared/auth/services'
import type { UserDtoType } from '@/shared/user/dtos'

import type { RemoveBodySchemaType, UpdateBodySchemaType } from '../schemas/me'
import { meService } from '../services/me'

/**
 * users feature の `/users/me` のコントローラ。
 * 返り値は OpenAPIHono の `openapi()` ハンドラが要求する型付きレスポンス（`TypedResponse`）を維持する。
 * これにより createRoute の responses 定義と実際の返り値が型レベルで整合する。
 */
export const meController = {
  /**
   * 認証済みユーザー自身の情報を返す。
   */
  get: async (c: Context, userId: number): Promise<TypedResponse<UserDtoType, 200, 'json'>> => {
    const user = await meService.get(userId)
    return c.json(user, 200)
  },

  /**
   * 認証済みユーザー自身の情報を更新する。
   */
  update: async (c: Context, userId: number, input: UpdateBodySchemaType): Promise<TypedResponse<UserDtoType, 200, 'json'>> => {
    const user = await meService.update(userId, input)
    return c.json(user, 200)
  },

  /**
   * 認証済みユーザー自身のアカウントを削除し、リフレッシュトークンCookieをクリアする。
   */
  remove: async (c: Context, userId: number, input: RemoveBodySchemaType): Promise<Response> => {
    await meService.remove(userId, input.currentPassword)
    clearRefreshTokenCookie(c)
    return c.body(null, 204)
  },
}
