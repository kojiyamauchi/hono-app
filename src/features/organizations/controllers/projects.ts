import type { Context, TypedResponse } from 'hono'

import type { ProjectDtoType, ProjectListDtoType } from '../dtos/projects'
import type { CreateProjectBodySchemaType, ListProjectsQuerySchemaType, UpdateProjectBodySchemaType } from '../schemas/projects'
import { projectsService } from '../services/projects'

/**
 * organizations/projects featureのコントローラ。
 * 書き込み系は操作者の認証済みユーザーIDだけを渡し、認可はserviceがロック後のロールで判定する。
 */
export const organizationsProjectsController = {
  /**
   * 組織のプロジェクト一覧を、検証済みqueryのlimit・cursorで1ページ分返す。
   */
  list: async (c: Context, organizationId: number, query: ListProjectsQuerySchemaType): Promise<TypedResponse<ProjectListDtoType, 200, 'json'>> => {
    const result = await projectsService.list(organizationId, query.limit, query.cursor)
    return c.json(result, 200)
  },

  /**
   * 組織内のプロジェクトを1件返す。
   */
  getById: async (c: Context, organizationId: number, projectId: number): Promise<TypedResponse<ProjectDtoType, 200, 'json'>> => {
    const result = await projectsService.getById(organizationId, projectId)
    return c.json(result, 200)
  },

  /**
   * プロジェクトを作成する。201で作成結果を返す。
   */
  create: async (
    c: Context,
    organizationId: number,
    actorUserId: number,
    input: CreateProjectBodySchemaType,
  ): Promise<TypedResponse<ProjectDtoType, 201, 'json'>> => {
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
    input: UpdateProjectBodySchemaType,
  ): Promise<TypedResponse<ProjectDtoType, 200, 'json'>> => {
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
