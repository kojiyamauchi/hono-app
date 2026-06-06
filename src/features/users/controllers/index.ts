import type { Context } from 'hono'

import type { UpdateMeInput } from '../schemas'
import { usersService } from '../services'

/**
 * users featureのコントローラ。
 */
export const usersController = {
  /**
   * 認証済みユーザー自身の情報を返す。
   */
  me: async (c: Context, userId: number): Promise<Response> => {
    const user = await usersService.getMe(userId)
    return c.json(user, 200)
  },

  /**
   * 認証済みユーザー自身の情報を更新する。
   */
  updateMe: async (c: Context, userId: number, input: UpdateMeInput): Promise<Response> => {
    const user = await usersService.updateMe(userId, input)
    return c.json(user, 200)
  },

  /**
   * 指定IDのユーザー公開情報を返す。
   */
  getById: async (c: Context, id: number): Promise<Response> => {
    const user = await usersService.getById(id)
    return c.json(user, 200)
  },
}
