import type { Context, TypedResponse } from 'hono'

import type { AuthResultDtoType } from '@/shared/auth/dtos'
import { setRefreshTokenCookie } from '@/shared/auth/services'
import type { InvitationDetailDtoType } from '@/shared/invitation/dtos'
import type { MemberDtoType } from '@/shared/membership/dtos'

import type { AcceptInvitationBodySchemaType, DeclineInvitationBodySchemaType, SignupInvitationBodySchemaType } from '../schemas'
import { invitationsService } from '../services'

/**
 * invitations featureのコントローラ。
 * 返り値は OpenAPIHono の `openapi()` ハンドラが要求する型付きレスポンス（`TypedResponse`）を維持する。
 * これにより createRoute の responses 定義と実際の返り値が型レベルで整合する。
 * 無内容応答（204）を返す decline は、`TypedResponse<null, 204, 'body'>` が openapi() の
 * 要求する型へ代入できないため、素直に `Response` を返す型にする。
 */
export const invitationsController = {
  /**
   * 招待トークンから招待詳細を取得する。200でInvitationDetailDtoTypeを返す。
   * 認証不要・読み取り専用。
   */
  getDetail: async (c: Context, token: string): Promise<TypedResponse<InvitationDetailDtoType, 200, 'json'>> => {
    const result = await invitationsService.getDetailByToken(token)
    return c.json(result, 200)
  },

  /**
   * 招待を受諾してメンバーになる。201でMemberDtoTypeを返す。
   */
  accept: async (c: Context, userId: number, input: AcceptInvitationBodySchemaType): Promise<TypedResponse<MemberDtoType, 201, 'json'>> => {
    const result = await invitationsService.accept(userId, input.token)
    return c.json(result, 201)
  },

  /**
   * 招待を辞退する。204 No Contentを返す。
   */
  decline: async (c: Context, input: DeclineInvitationBodySchemaType): Promise<Response> => {
    await invitationsService.decline(input.token)
    return c.body(null, 204)
  },

  /**
   * 招待経由で新規登録する。201でアクセストークンとユーザー情報を返す。
   * リフレッシュトークンはCookieへセットする。
   */
  signup: async (c: Context, input: SignupInvitationBodySchemaType): Promise<TypedResponse<AuthResultDtoType, 201, 'json'>> => {
    const result = await invitationsService.signup(input.token, input.name, input.password)
    setRefreshTokenCookie(c, result.refreshToken)
    return c.json({ token: result.token, user: result.user }, 201)
  },
}
