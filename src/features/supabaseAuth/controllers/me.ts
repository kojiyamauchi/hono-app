import type { User } from '@supabase/supabase-js'
import type { Context, TypedResponse } from 'hono'

import type { SupabaseUserDtoType } from '../dtos'

/**
 * Supabase Auth /me のコントローラ。
 */
export const meController = {
  /**
   * 認証済みユーザー自身の情報を返す（ミドルウェアが検証済み）。
   */
  get: (c: Context, user: User): TypedResponse<SupabaseUserDtoType, 200, 'json'> => {
    return c.json(user, 200)
  },
}
