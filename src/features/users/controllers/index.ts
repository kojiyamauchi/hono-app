import type { Context, TypedResponse } from 'hono'

import { clearRefreshTokenCookie } from '@/shared/auth/services'
import type { PublicUserDtoType, UserDtoType } from '@/shared/user/dtos'

import type { DeleteMeSchemaType, UpdateMeSchemaType } from '../schemas'
import { usersService } from '../services'

/**
 * users featureのコントローラ。
 * 返り値は OpenAPIHono の `openapi()` ハンドラが要求する型付きレスポンス（`TypedResponse`）を維持する。
 * これにより createRoute の responses 定義と実際の返り値が型レベルで整合する。
 */
export const usersController = {
  /**
   * 認証済みユーザー自身の情報を返す。
   */
  me: async (c: Context, userId: number): Promise<TypedResponse<UserDtoType, 200, 'json'>> => {
    const user = await usersService.getMe(userId)
    return c.json(user, 200)
  },

  /**
   * 認証済みユーザー自身の情報を更新する。
   */
  updateMe: async (c: Context, userId: number, input: UpdateMeSchemaType): Promise<TypedResponse<UserDtoType, 200, 'json'>> => {
    const user = await usersService.updateMe(userId, input)
    return c.json(user, 200)
  },

  /**
   * 認証済みユーザー自身のアカウントを削除し、リフレッシュトークンCookieをクリアする。
   */
  deleteMe: async (c: Context, userId: number, input: DeleteMeSchemaType): Promise<Response> => {
    await usersService.deleteMe(userId, input.currentPassword)
    clearRefreshTokenCookie(c)
    return c.body(null, 204)
  },

  /**
   * 指定IDのユーザー公開情報を返す。
   */
  getById: async (c: Context, id: number): Promise<TypedResponse<PublicUserDtoType, 200, 'json'>> => {
    const user = await usersService.getById(id)
    return c.json(user, 200)
  },
}
