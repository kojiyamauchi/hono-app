import type { Context, TypedResponse } from 'hono'

import type { InvitationDtoType, InvitationListItemDtoType } from '@/shared/invitation/dtos'
import type { Role } from '@/shared/membership/entities'

import type { CreateBodySchemaType } from '../schemas/invitations'
import { invitationsService } from '../services/invitations'

/**
 * organizations/invitations featureのコントローラ。
 */
export const invitationsController = {
  /**
   * 招待を作成する。201で作成結果を返す。
   */
  create: async (
    c: Context,
    organizationId: number,
    operatorRole: Role,
    input: CreateBodySchemaType,
  ): Promise<TypedResponse<InvitationDtoType, 201, 'json'>> => {
    const result = await invitationsService.create(organizationId, operatorRole, input)
    return c.json(result, 201)
  },

  /**
   * 招待一覧を返す。デフォルトはPENDINGのみ。
   */
  list: async (c: Context, organizationId: number, operatorRole: Role): Promise<TypedResponse<InvitationListItemDtoType[], 200, 'json'>> => {
    const result = await invitationsService.list(organizationId, operatorRole)
    return c.json(result, 200)
  },

  /**
   * 招待をキャンセルする。204を返す。
   */
  cancel: async (c: Context, organizationId: number, invitationId: number, operatorRole: Role): Promise<Response> => {
    await invitationsService.cancel(organizationId, invitationId, operatorRole)
    return c.body(null, 204)
  },

  /**
   * 招待メールの再送を受け付ける。配信待ちの保存までを示す本文なしの202を返す。
   */
  resendEmail: async (c: Context, organizationId: number, invitationId: number, actorUserId: number): Promise<Response> => {
    await invitationsService.resendEmail(organizationId, invitationId, actorUserId)
    return c.body(null, 202)
  },
}
