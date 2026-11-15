import type { Context, TypedResponse } from 'hono'

import type { AuthResultDtoType } from '@/shared/auth/dtos'
import { setRefreshTokenCookie } from '@/shared/auth/services'

import type { BodySchemaType } from '../schemas/login'
import { loginService } from '../services/login'
import { getClientIp } from './common'

/**
 * auth/login のコントローラ。
 * リフレッシュトークンはHttpOnly Cookieとしてセットし、bodyには認証結果DTO（AuthResultDtoType）のみ返す。
 */
export const loginController = {
  /**
   * ログイン。200でアクセストークンとユーザー情報を返す。
   * リフレッシュトークンはCookieへセットする。
   * IP単位・email単位のレート制限超過時は429を返す。
   */
  execute: async (c: Context, input: BodySchemaType): Promise<TypedResponse<AuthResultDtoType, 200, 'json'>> => {
    const result = await loginService.execute(input, getClientIp(c))
    setRefreshTokenCookie(c, result.refreshToken)
    return c.json({ token: result.token, user: result.user }, 200)
  },
}
