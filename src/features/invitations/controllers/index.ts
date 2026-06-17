import type { Context } from 'hono'

import type { AcceptInvitationBodySchemaType, DeclineInvitationBodySchemaType, SignupInvitationBodySchemaType } from '../schemas'
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

  /**
   * 招待を辞退する。204 No Contentを返す。
   */
  decline: async (c: Context, input: DeclineInvitationBodySchemaType): Promise<Response> => {
    await invitationsService.decline(input.token)
    return c.body(null, 204)
  },

  /**
   * 招待経由で新規登録する。201でAuthResultを返す。
   */
  signup: async (c: Context, input: SignupInvitationBodySchemaType): Promise<Response> => {
    const result = await invitationsService.signup(input.token, input.name, input.password)
    return c.json(result, 201)
  },
}
