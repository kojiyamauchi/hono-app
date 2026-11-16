import type { Context, TypedResponse } from 'hono'

import type { AuthResultDtoType } from '../dtos'
import type { BodySchemaType } from '../schemas/signup'
import { signupService } from '../services/signup'

/**
 * Supabase Auth サインアップのコントローラ。
 * 返り値は OpenAPIHono の `openapi()` ハンドラが要求する型付きレスポンス（`TypedResponse`）を維持する。
 * これにより createRoute の responses 定義と実際の返り値が型レベルで整合する。
 */
export const signupController = {
  /**
   * サインアップ。201で作成結果を返す。
   */
  execute: async (c: Context, input: BodySchemaType): Promise<TypedResponse<AuthResultDtoType, 201, 'json'>> => {
    const result = await signupService.execute(input)
    return c.json(result, 201)
  },
}
