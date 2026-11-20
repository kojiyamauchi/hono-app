import type { Context, TypedResponse } from 'hono'

import type { ItemDtoType, ListDtoType } from '../dtos/tasks'
import type { CreateBodySchemaType, ListQuerySchemaType, UpdateBodySchemaType } from '../schemas/tasks'
import { tasksService } from '../services/tasks'

/**
 * organizations/tasks featureのコントローラ。
 * 書き込み系は操作者の認証済みユーザーIDだけを渡し、認可はserviceがロック後のロールで判定する。
 */
export const tasksController = {
  /**
   * プロジェクトのタスク一覧を、検証済みqueryのlimit・status・cursorで1ページ分返す。
   */
  list: async (c: Context, organizationId: number, projectId: number, query: ListQuerySchemaType): Promise<TypedResponse<ListDtoType, 200, 'json'>> => {
    const result = await tasksService.list(organizationId, projectId, query.limit, query.status, query.cursor)
    return c.json(result, 200)
  },

  /**
   * プロジェクト内のタスクを1件返す。
   */
  getById: async (c: Context, organizationId: number, projectId: number, taskId: number): Promise<TypedResponse<ItemDtoType, 200, 'json'>> => {
    const result = await tasksService.getById(organizationId, projectId, taskId)
    return c.json(result, 200)
  },

  /**
   * タスクを作成する。201で作成結果を返す。
   */
  create: async (
    c: Context,
    organizationId: number,
    projectId: number,
    actorUserId: number,
    input: CreateBodySchemaType,
  ): Promise<TypedResponse<ItemDtoType, 201, 'json'>> => {
    const result = await tasksService.create(organizationId, projectId, actorUserId, input)
    return c.json(result, 201)
  },

  /**
   * タスクを部分更新する。200で更新後の結果を返す。
   */
  update: async (
    c: Context,
    organizationId: number,
    projectId: number,
    taskId: number,
    actorUserId: number,
    input: UpdateBodySchemaType,
  ): Promise<TypedResponse<ItemDtoType, 200, 'json'>> => {
    const result = await tasksService.update(organizationId, projectId, taskId, actorUserId, input)
    return c.json(result, 200)
  },

  /**
   * タスクを完全削除する。204を返す。
   */
  remove: async (c: Context, organizationId: number, projectId: number, taskId: number, actorUserId: number): Promise<Response> => {
    await tasksService.remove(organizationId, projectId, taskId, actorUserId)
    return c.body(null, 204)
  },
}
