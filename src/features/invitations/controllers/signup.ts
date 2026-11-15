import type { Context, TypedResponse } from 'hono'

import type { AuthResultDtoType } from '@/shared/auth/dtos'
import { setRefreshTokenCookie } from '@/shared/auth/services/cookie'

import type { BodySchemaType } from '../schemas/signup'
import { signupService } from '../services/signup'

/**
 * 招待経由サインアップのコントローラ。
 * 返り値は OpenAPIHono の `openapi()` ハンドラが要求する型付きレスポンス（`TypedResponse`）を維持する。
 */
export const signupController = {
  /**
   * 招待経由で新規登録する。201でアクセストークンとユーザー情報を返す。
   * リフレッシュトークンはCookieへセットする。
   */
  execute: async (c: Context, input: BodySchemaType): Promise<TypedResponse<AuthResultDtoType, 201, 'json'>> => {
    const result = await signupService.execute(input.token, input.name, input.password)
    setRefreshTokenCookie(c, result.refreshToken)
    return c.json({ token: result.token, user: result.user }, 201)
  },
}
