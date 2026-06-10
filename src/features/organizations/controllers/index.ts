import type { Context } from 'hono'

import type { Role } from '@/shared/membership/entities'

import type { AddMemberBodyInput, CreateOrganizationInput, UpdateMemberRoleBodyInput, UpdateOrganizationInput } from '../schemas'
import { organizationsService } from '../services'

/**
 * organizations featureのコントローラ。
 */
export const organizationsController = {
  /**
   * 組織を作成する。201で作成結果を返す。
   */
  create: async (c: Context, userId: number, input: CreateOrganizationInput): Promise<Response> => {
    const result = await organizationsService.create(userId, input)
    return c.json(result, 201)
  },

  /**
   * 認証済みユーザーが所属する組織の一覧を返す。
   */
  listMine: async (c: Context, userId: number): Promise<Response> => {
    const result = await organizationsService.listMine(userId)
    return c.json(result, 200)
  },

  /**
   * 指定IDの組織情報を返す。
   */
  getById: async (c: Context, organizationId: number): Promise<Response> => {
    const result = await organizationsService.getById(organizationId)
    return c.json(result, 200)
  },

  /**
   * 組織を更新する。
   */
  update: async (c: Context, organizationId: number, input: UpdateOrganizationInput, role: Role): Promise<Response> => {
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
}

/**
 * organizations/members featureのコントローラ。
 */
export const organizationsMembersController = {
  /**
   * 組織のメンバー一覧を返す。
   */
  listMembers: async (c: Context, organizationId: number): Promise<Response> => {
    const result = await organizationsService.listMembers(organizationId)
    return c.json(result, 200)
  },

  /**
   * メンバーを追加する。201で作成結果を返す。
   */
  addMember: async (c: Context, organizationId: number, operatorRole: Role, input: AddMemberBodyInput): Promise<Response> => {
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
    input: UpdateMemberRoleBodyInput,
  ): Promise<Response> => {
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
