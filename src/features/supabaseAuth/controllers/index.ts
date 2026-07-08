import type { User } from '@supabase/supabase-js'
import type { Context, TypedResponse } from 'hono'

import type { AuthResultDtoType, SupabaseUserDtoType } from '../dtos'
import type { LoginSchemaType, SignupSchemaType } from '../schemas'
import { supabaseAuthService } from '../services'

/**
 * Supabase Auth エンドポイントのコントローラ。
 * 返り値は OpenAPIHono の `openapi()` ハンドラが要求する型付きレスポンス（`TypedResponse`）を維持する。
 * これにより createRoute の responses 定義と実際の返り値が型レベルで整合する。
 */
export const supabaseAuthController = {
  /**
   * サインアップ。201で作成結果を返す。
   */
  signup: async (c: Context, input: SignupSchemaType): Promise<TypedResponse<AuthResultDtoType, 201, 'json'>> => {
    const result = await supabaseAuthService.signup(input)
    return c.json(result, 201)
  },

  /**
   * ログイン。200でトークンとユーザー情報を返す。
   */
  login: async (c: Context, input: LoginSchemaType): Promise<TypedResponse<AuthResultDtoType, 200, 'json'>> => {
    const result = await supabaseAuthService.login(input)
    return c.json(result, 200)
  },

  /**
   * 認証済みユーザー自身の情報を返す（ミドルウェアが検証済み）。
   */
  me: (c: Context, user: User): TypedResponse<SupabaseUserDtoType, 200, 'json'> => {
    return c.json(user, 200)
  },
}
