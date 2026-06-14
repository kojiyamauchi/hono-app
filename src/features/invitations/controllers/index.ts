import type { Context } from 'hono'

import type { AcceptInvitationBodySchemaType } from '../schemas'
import { invitationsService } from '../services'

/**
 * invitations featureのコントローラ。
 */
export const invitationsController = {
  /**
   * 招待を受諾してメンバーになる。201でMemberResponseを返す。
   */
  accept: async (c: Context, userId: number, input: AcceptInvitationBodySchemaType): Promise<Response> => {
    const result = await invitationsService.accept(userId, input.token)
    return c.json(result, 201)
  },
}
