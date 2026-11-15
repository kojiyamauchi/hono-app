import type { Context, TypedResponse } from 'hono'

import type { AuthResultDtoType } from '@/shared/auth/dtos'
import { setRefreshTokenCookie } from '@/shared/auth/services/cookie'

import type { BodySchemaType } from '../schemas/signup'
import { signupService } from '../services/signup'
import { getClientIp } from './common'

/**
 * auth/signup のコントローラ。
 * リフレッシュトークンはHttpOnly Cookieとしてセットし、bodyには認証結果DTO（AuthResultDtoType）のみ返す。
 */
export const signupController = {
  /**
   * サインアップ。201でアクセストークンとユーザー情報を返す。
   * リフレッシュトークンはCookieへセットする。
   * IP単位のレート制限超過時は429を返す。
   */
  execute: async (c: Context, input: BodySchemaType): Promise<TypedResponse<AuthResultDtoType, 201, 'json'>> => {
    const result = await signupService.execute(input, getClientIp(c))
    setRefreshTokenCookie(c, result.refreshToken)
    return c.json({ token: result.token, user: result.user }, 201)
  },
}
