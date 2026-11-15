import type { Context, TypedResponse } from 'hono'

import type { MemberDtoType } from '@/shared/membership/dtos'

import type { BodySchemaType } from '../schemas/accept'
import { acceptService } from '../services/accept'

/**
 * 招待受諾のコントローラ。
 * 返り値は OpenAPIHono の `openapi()` ハンドラが要求する型付きレスポンス（`TypedResponse`）を維持する。
 */
export const acceptController = {
  /**
   * 招待を受諾してメンバーになる。201でMemberDtoTypeを返す。
   */
  execute: async (c: Context, userId: number, input: BodySchemaType): Promise<TypedResponse<MemberDtoType, 201, 'json'>> => {
    const result = await acceptService.execute(userId, input.token)
    return c.json(result, 201)
  },
}
