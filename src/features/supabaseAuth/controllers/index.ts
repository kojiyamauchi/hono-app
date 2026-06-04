import type { User } from '@supabase/supabase-js'
import type { Context } from 'hono'

import type { LoginInput, SignupInput } from '../schemas'
import { supabaseAuthService } from '../services'

/**
 * Supabase Auth エンドポイントのコントローラ。
 */
export const supabaseAuthController = {
  /**
   * サインアップ。201で作成結果を返す。
   */
  signup: async (c: Context, input: SignupInput): Promise<Response> => {
    const result = await supabaseAuthService.signup(input)
    return c.json(result, 201)
  },

  /**
   * ログイン。200でトークンとユーザー情報を返す。
   */
  login: async (c: Context, input: LoginInput): Promise<Response> => {
    const result = await supabaseAuthService.login(input)
    return c.json(result, 200)
  },

  /**
   * 認証済みユーザー自身の情報を返す（ミドルウェアが検証済み）。
   */
  me: (c: Context, user: User): Response => {
    return c.json(user, 200)
  },
}
