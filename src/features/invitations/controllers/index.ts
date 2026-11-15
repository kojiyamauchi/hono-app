import type { Context, TypedResponse } from 'hono'

import type { InvitationDetailDtoType } from '@/shared/invitation/dtos'

import { service } from '../services'

/**
 * invitations featureのコントローラ。
 * 返り値は OpenAPIHono の `openapi()` ハンドラが要求する型付きレスポンス（`TypedResponse`）を維持する。
 * これにより createRoute の responses 定義と実際の返り値が型レベルで整合する。
 */
export const controller = {
  /**
   * 招待トークンから招待詳細を取得する。200でInvitationDetailDtoTypeを返す。
   * 認証不要・読み取り専用。
   */
  getDetail: async (c: Context, token: string): Promise<TypedResponse<InvitationDetailDtoType, 200, 'json'>> => {
    const result = await service.getDetailByToken(token)
    return c.json(result, 200)
  },
}
