import type { Context, TypedResponse } from 'hono'

import type { ItemDtoType, ListDtoType } from '../dtos/projects'
import type { CreateBodySchemaType, ListQuerySchemaType, UpdateBodySchemaType } from '../schemas/projects'
import { projectsService } from '../services/projects'

/**
 * organizations/projects featureのコントローラ。
 * 書き込み系は操作者の認証済みユーザーIDだけを渡し、認可はserviceがロック後のロールで判定する。
 */
export const projectsController = {
  /**
   * 組織のプロジェクト一覧を、検証済みqueryのlimit・cursorで1ページ分返す。
   */
  list: async (c: Context, organizationId: number, query: ListQuerySchemaType): Promise<TypedResponse<ListDtoType, 200, 'json'>> => {
    const result = await projectsService.list(organizationId, query.limit, query.cursor)
    return c.json(result, 200)
  },

  /**
   * 組織内のプロジェクトを1件返す。
   */
  getById: async (c: Context, organizationId: number, projectId: number): Promise<TypedResponse<ItemDtoType, 200, 'json'>> => {
    const result = await projectsService.getById(organizationId, projectId)
    return c.json(result, 200)
  },

  /**
   * プロジェクトを作成する。201で作成結果を返す。
   */
  create: async (c: Context, organizationId: number, actorUserId: number, input: CreateBodySchemaType): Promise<TypedResponse<ItemDtoType, 201, 'json'>> => {
    const result = await projectsService.create(organizationId, actorUserId, input)
    return c.json(result, 201)
  },

  /**
   * プロジェクトを部分更新する。200で更新後の結果を返す。
   */
  update: async (
    c: Context,
    organizationId: number,
    projectId: number,
    actorUserId: number,
    input: UpdateBodySchemaType,
  ): Promise<TypedResponse<ItemDtoType, 200, 'json'>> => {
    const result = await projectsService.update(organizationId, projectId, actorUserId, input)
    return c.json(result, 200)
  },

  /**
   * プロジェクトを完全削除する。204を返す。
   */
  remove: async (c: Context, organizationId: number, projectId: number, actorUserId: number): Promise<Response> => {
    await projectsService.remove(organizationId, projectId, actorUserId)
    return c.body(null, 204)
  },
}
