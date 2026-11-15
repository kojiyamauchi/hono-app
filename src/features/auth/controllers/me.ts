import type { Context, TypedResponse } from 'hono'

import type { UserDtoType } from '@/shared/user/dtos'

import { meService } from '../services/me'

/**
 * auth/me のコントローラ。
 */
export const meController = {
  /**
   * 認証済みユーザー自身の情報を返す。
   */
  get: async (c: Context, userId: number): Promise<TypedResponse<UserDtoType, 200, 'json'>> => {
    const user = await meService.get(userId)
    return c.json(user, 200)
  },
}
