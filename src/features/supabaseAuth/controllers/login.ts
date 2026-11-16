import type { Context, TypedResponse } from 'hono'

import type { AuthResultDtoType } from '../dtos'
import type { BodySchemaType } from '../schemas/login'
import { loginService } from '../services/login'

/**
 * Supabase Auth ログインのコントローラ。
 * 返り値は OpenAPIHono の `openapi()` ハンドラが要求する型付きレスポンス（`TypedResponse`）を維持する。
 * これにより createRoute の responses 定義と実際の返り値が型レベルで整合する。
 */
export const loginController = {
  /**
   * ログイン。200でトークンとユーザー情報を返す。
   */
  execute: async (c: Context, input: BodySchemaType): Promise<TypedResponse<AuthResultDtoType, 200, 'json'>> => {
    const result = await loginService.execute(input)
    return c.json(result, 200)
  },
}
