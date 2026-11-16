import type { Context, TypedResponse } from 'hono'

import type { MemberDtoType } from '@/shared/membership/dtos'
import type { Role } from '@/shared/membership/entities'

import type { ListDtoType } from '../dtos/members'
import type { AddBodySchemaType, ListQuerySchemaType, UpdateRoleBodySchemaType } from '../schemas/members'
import { membersService } from '../services/members'

/**
 * organizations/members featureのコントローラ。
 */
export const membersController = {
  /**
   * 認証ユーザー自身を組織から脱退させる。204を返す。
   */
  leave: async (c: Context, organizationId: number, userId: number): Promise<Response> => {
    await membersService.leave(organizationId, userId)
    return c.body(null, 204)
  },

  /**
   * 組織のメンバー一覧を、検証済みqueryのlimit・cursorで1ページ分返す。
   */
  list: async (c: Context, organizationId: number, query: ListQuerySchemaType): Promise<TypedResponse<ListDtoType, 200, 'json'>> => {
    const result = await membersService.list(organizationId, query.limit, query.cursor)
    return c.json(result, 200)
  },

  /**
   * メンバーを追加する。201で作成結果を返す。
   */
  add: async (c: Context, organizationId: number, operatorRole: Role, input: AddBodySchemaType): Promise<TypedResponse<MemberDtoType, 201, 'json'>> => {
    const result = await membersService.add(organizationId, operatorRole, input)
    return c.json(result, 201)
  },

  /**
   * メンバーのロールを変更する。操作者の認証済みユーザーIDは監査ログの記録に使う。
   */
  updateRole: async (
    c: Context,
    organizationId: number,
    membershipId: number,
    actorUserId: number,
    operatorRole: Role,
    input: UpdateRoleBodySchemaType,
  ): Promise<TypedResponse<MemberDtoType, 200, 'json'>> => {
    const result = await membersService.updateRole(organizationId, membershipId, actorUserId, operatorRole, input)
    return c.json(result, 200)
  },

  /**
   * メンバーを削除する。204を返す。操作者は認証済みユーザーIDで渡し、認可はserviceがロック後のロールで判定する。
   */
  remove: async (c: Context, organizationId: number, membershipId: number, actorUserId: number): Promise<Response> => {
    await membersService.remove(organizationId, membershipId, actorUserId)
    return c.body(null, 204)
  },
}
