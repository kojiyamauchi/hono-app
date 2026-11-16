import type { Context, TypedResponse } from 'hono'

import type { AuthResultDtoType } from '@/shared/auth/dtos'
import { getRefreshTokenCookie, setRefreshTokenCookie } from '@/shared/auth/services/cookie'
import { AppError } from '@/utils/errors'

import { refreshService } from '../services/refresh'

/**
 * auth/refresh のコントローラ。
 */
export const refreshController = {
  /**
   * Cookieからリフレッシュトークンを取得してローテーションし、200で新しいアクセストークンを返す。
   * Cookieが存在しない場合は401。
   */
  execute: async (c: Context): Promise<TypedResponse<AuthResultDtoType, 200, 'json'>> => {
    const cookieToken = getRefreshTokenCookie(c)
    if (!cookieToken) {
      throw new AppError(401, 'リフレッシュトークンが見つかりません')
    }
    const result = await refreshService.execute(cookieToken)
    setRefreshTokenCookie(c, result.refreshToken)
    return c.json({ token: result.token, user: result.user }, 200)
  },
}
