import type { Context, TypedResponse } from 'hono'

import type { InvitationDtoType } from '@/shared/invitation/dtos'
import type { MemberDtoType } from '@/shared/membership/dtos'
import type { Role } from '@/shared/membership/entities'
import type { OrganizationDtoType } from '@/shared/organization/dtos'

import type {
  AddMemberBodySchemaType,
  CreateInvitationBodySchemaType,
  CreateOrganizationSchemaType,
  TransferOwnershipBodySchemaType,
  UpdateMemberRoleBodySchemaType,
  UpdateOrganizationSchemaType,
} from '../schemas'
import { organizationsService } from '../services'

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
  create: async (c: Context, userId: number, input: CreateOrganizationSchemaType): Promise<TypedResponse<OrganizationDtoType, 201, 'json'>> => {
    const result = await organizationsService.create(userId, input)
    return c.json(result, 201)
  },

  /**
   * 認証済みユーザーが所属する組織の一覧を返す。
   */
  listMine: async (c: Context, userId: number): Promise<TypedResponse<OrganizationDtoType[], 200, 'json'>> => {
    const result = await organizationsService.listMine(userId)
    return c.json(result, 200)
  },

  /**
   * 指定IDの組織情報を返す。
   */
  getById: async (c: Context, organizationId: number): Promise<TypedResponse<OrganizationDtoType, 200, 'json'>> => {
    const result = await organizationsService.getById(organizationId)
    return c.json(result, 200)
  },

  /**
   * 組織を更新する。
   */
  update: async (
    c: Context,
    organizationId: number,
    input: UpdateOrganizationSchemaType,
    role: Role,
  ): Promise<TypedResponse<OrganizationDtoType, 200, 'json'>> => {
    const result = await organizationsService.update(organizationId, input, role)
    return c.json(result, 200)
  },

  /**
   * 組織を削除する。204を返す。
   */
  remove: async (c: Context, organizationId: number, role: Role): Promise<Response> => {
    await organizationsService.remove(organizationId, role)
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
    await organizationsService.transferOwnership(organizationId, currentOwnerUserId, operatorRole, input.membershipId)
    return c.body(null, 204)
  },
}

/**
 * organizations/members featureのコントローラ。
 */
export const organizationsMembersController = {
  /**
   * 組織のメンバー一覧を返す。
   */
  listMembers: async (c: Context, organizationId: number): Promise<TypedResponse<MemberDtoType[], 200, 'json'>> => {
    const result = await organizationsService.listMembers(organizationId)
    return c.json(result, 200)
  },

  /**
   * メンバーを追加する。201で作成結果を返す。
   */
  addMember: async (
    c: Context,
    organizationId: number,
    operatorRole: Role,
    input: AddMemberBodySchemaType,
  ): Promise<TypedResponse<MemberDtoType, 201, 'json'>> => {
    const result = await organizationsService.addMember(organizationId, operatorRole, input)
    return c.json(result, 201)
  },

  /**
   * メンバーのロールを変更する。
   */
  updateMemberRole: async (
    c: Context,
    organizationId: number,
    membershipId: number,
    operatorRole: Role,
    input: UpdateMemberRoleBodySchemaType,
  ): Promise<TypedResponse<MemberDtoType, 200, 'json'>> => {
    const result = await organizationsService.updateMemberRole(organizationId, membershipId, operatorRole, input)
    return c.json(result, 200)
  },

  /**
   * メンバーを削除する。204を返す。
   */
  removeMember: async (c: Context, organizationId: number, membershipId: number, operatorRole: Role): Promise<Response> => {
    await organizationsService.removeMember(organizationId, membershipId, operatorRole)
    return c.body(null, 204)
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
    const result = await organizationsService.createInvitation(organizationId, operatorRole, input)
    return c.json(result, 201)
  },

  /**
   * 招待一覧を返す。デフォルトはPENDINGのみ。
   */
  listInvitations: async (c: Context, organizationId: number, operatorRole: Role): Promise<TypedResponse<InvitationDtoType[], 200, 'json'>> => {
    const result = await organizationsService.listInvitations(organizationId, operatorRole)
    return c.json(result, 200)
  },

  /**
   * 招待をキャンセルする。204を返す。
   */
  cancelInvitation: async (c: Context, organizationId: number, invitationId: number, operatorRole: Role): Promise<Response> => {
    await organizationsService.cancelInvitation(organizationId, invitationId, operatorRole)
    return c.body(null, 204)
  },
}
