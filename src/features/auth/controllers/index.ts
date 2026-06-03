import type { Context } from 'hono'

import type { LoginInput, SignupInput } from '../schemas'
import { authService } from '../services'

/**
 * 認証エンドポイントのコントローラ。
 * バリデーション済みの入力を受け取り、serviceを呼び出してレスポンスを返す。
 */
export const authController = {
  /**
   * サインアップ。201で作成結果を返す。
   */
  signup: async (c: Context, input: SignupInput): Promise<Response> => {
    const result = await authService.signup(input)
    return c.json(result, 201)
  },

  /**
   * ログイン。200でトークンとユーザー情報を返す。
   */
  login: async (c: Context, input: LoginInput): Promise<Response> => {
    const result = await authService.login(input)
    return c.json(result, 200)
  },

  /**
   * 認証済みユーザー自身の情報を返す。
   */
  me: async (c: Context, userId: number): Promise<Response> => {
    const user = await authService.getById(userId)
    return c.json(user, 200)
  },
}
