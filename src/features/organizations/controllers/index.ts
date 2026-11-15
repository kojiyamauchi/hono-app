import type { Context, TypedResponse } from 'hono'

import type { InvitationDtoType, InvitationListItemDtoType } from '@/shared/invitation/dtos'
import type { MemberDtoType } from '@/shared/membership/dtos'
import type { Role } from '@/shared/membership/entities'
import type { OrganizationDtoType } from '@/shared/organization/dtos'

import type { ListDtoType as OrganizationListDtoType } from '../dtos'
import type { ListDtoType as AuditLogListDtoType } from '../dtos/auditLogs'
import type { ListDtoType as MemberListDtoType } from '../dtos/members'
import type { CreateSchemaType, ListMineQuerySchemaType, UpdateSchemaType } from '../schemas'
import type { ListQuerySchemaType as AuditLogListQuerySchemaType } from '../schemas/auditLogs'
import type { CreateBodySchemaType as CreateInvitationBodySchemaType } from '../schemas/invitations'
import type { AddBodySchemaType, ListQuerySchemaType as MemberListQuerySchemaType, UpdateRoleBodySchemaType } from '../schemas/members'
import type { BodySchemaType as TransferOwnershipBodySchemaType } from '../schemas/transferOwnership'
import { service } from '../services'
import { auditLogsService } from '../services/auditLogs'
import { invitationsService } from '../services/invitations'
import { membersService } from '../services/members'
import { transferOwnershipService } from '../services/transferOwnership'

/**
 * organizations featureのコントローラ。
 * JSON応答を返すメソッドは、OpenAPIHono の `openapi()` ハンドラが要求する型付きレスポンス（`TypedResponse`）を返す。
 * 無内容応答（204）を返すメソッドは、`TypedResponse<null, 204, 'body'>` が openapi() の
 * 要求する型へ代入できないため、素直に `Response` を返す型にする。
 */
export const organizationsController = {
  /**
   * 組織を作成する。201で作成結果を返す。
   */
  create: async (c: Context, userId: number, input: CreateSchemaType): Promise<TypedResponse<OrganizationDtoType, 201, 'json'>> => {
    const result = await service.create(userId, input)
    return c.json(result, 201)
  },

  /**
   * 認証済みユーザーが所属する組織の一覧を、検証済みqueryのlimit・offsetで1ページ分返す。
   */
  listMine: async (c: Context, userId: number, query: ListMineQuerySchemaType): Promise<TypedResponse<OrganizationListDtoType, 200, 'json'>> => {
    const result = await service.listMine(userId, query.limit, query.offset)
    return c.json(result, 200)
  },

  /**
   * 指定IDの組織情報を返す。
   */
  getById: async (c: Context, organizationId: number): Promise<TypedResponse<OrganizationDtoType, 200, 'json'>> => {
    const result = await service.getById(organizationId)
    return c.json(result, 200)
  },

  /**
   * 組織を更新する。
   */
  update: async (c: Context, organizationId: number, input: UpdateSchemaType, role: Role): Promise<TypedResponse<OrganizationDtoType, 200, 'json'>> => {
    const result = await service.update(organizationId, input, role)
    return c.json(result, 200)
  },

  /**
   * 組織を削除する。204を返す。
   */
  remove: async (c: Context, organizationId: number, role: Role): Promise<Response> => {
    await service.remove(organizationId, role)
    return c.body(null, 204)
  },

  /**
   * 組織の所有権を既存メンバーへ移譲する。204を返す。
   */
  transferOwnership: async (
    c: Context,
    organizationId: number,
    currentOwnerUserId: number,
    operatorRole: Role,
    input: TransferOwnershipBodySchemaType,
  ): Promise<Response> => {
    await transferOwnershipService.execute(organizationId, currentOwnerUserId, operatorRole, input.membershipId)
    return c.body(null, 204)
  },
}

/**
 * organizations/members featureのコントローラ。
 */
export const organizationsMembersController = {
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
  listMembers: async (c: Context, organizationId: number, query: MemberListQuerySchemaType): Promise<TypedResponse<MemberListDtoType, 200, 'json'>> => {
    const result = await membersService.list(organizationId, query.limit, query.cursor)
    return c.json(result, 200)
  },

  /**
   * メンバーを追加する。201で作成結果を返す。
   */
  addMember: async (c: Context, organizationId: number, operatorRole: Role, input: AddBodySchemaType): Promise<TypedResponse<MemberDtoType, 201, 'json'>> => {
    const result = await membersService.add(organizationId, operatorRole, input)
    return c.json(result, 201)
  },

  /**
   * メンバーのロールを変更する。操作者の認証済みユーザーIDは監査ログの記録に使う。
   */
  updateMemberRole: async (
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
  removeMember: async (c: Context, organizationId: number, membershipId: number, actorUserId: number): Promise<Response> => {
    await membersService.remove(organizationId, membershipId, actorUserId)
    return c.body(null, 204)
  },
}

/**
 * organizations/audit-logs featureのコントローラ。
 */
export const organizationsAuditLogsController = {
  /**
   * 組織の監査ログを、検証済みqueryのlimit・cursorで1ページ分返す。
   */
  listAuditLogs: async (c: Context, organizationId: number, query: AuditLogListQuerySchemaType): Promise<TypedResponse<AuditLogListDtoType, 200, 'json'>> => {
    const result = await auditLogsService.list(organizationId, query.limit, query.cursor)
    return c.json(result, 200)
  },
}

/**
 * organizations/invitations featureのコントローラ。
 */
export const organizationsInvitationsController = {
  /**
   * 招待を作成する。201で作成結果を返す。
   */
  createInvitation: async (
    c: Context,
    organizationId: number,
    operatorRole: Role,
    input: CreateInvitationBodySchemaType,
  ): Promise<TypedResponse<InvitationDtoType, 201, 'json'>> => {
    const result = await invitationsService.create(organizationId, operatorRole, input)
    return c.json(result, 201)
  },

  /**
   * 招待一覧を返す。デフォルトはPENDINGのみ。
   */
  listInvitations: async (c: Context, organizationId: number, operatorRole: Role): Promise<TypedResponse<InvitationListItemDtoType[], 200, 'json'>> => {
    const result = await invitationsService.list(organizationId, operatorRole)
    return c.json(result, 200)
  },

  /**
   * 招待をキャンセルする。204を返す。
   */
  cancelInvitation: async (c: Context, organizationId: number, invitationId: number, operatorRole: Role): Promise<Response> => {
    await invitationsService.cancel(organizationId, invitationId, operatorRole)
    return c.body(null, 204)
  },

  /**
   * 招待メールの再送を受け付ける。配信待ちの保存までを示す本文なしの202を返す。
   */
  resendInvitationEmail: async (c: Context, organizationId: number, invitationId: number, actorUserId: number): Promise<Response> => {
    await invitationsService.resendEmail(organizationId, invitationId, actorUserId)
    return c.body(null, 202)
  },
}
