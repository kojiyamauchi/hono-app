import type { Context, TypedResponse } from 'hono'

import type { Role } from '@/shared/membership/entities'
import type { OrganizationDtoType } from '@/shared/organization/dtos'

import type { ListDtoType } from '../dtos'
import type { CreateSchemaType, ListMineQuerySchemaType, UpdateSchemaType } from '../schemas'
import { service } from '../services'

/**
 * organizations featureのコントローラ。
 * JSON応答を返すメソッドは、OpenAPIHono の `openapi()` ハンドラが要求する型付きレスポンス（`TypedResponse`）を返す。
 * 無内容応答（204）を返すメソッドは、`TypedResponse<null, 204, 'body'>` が openapi() の
 * 要求する型へ代入できないため、素直に `Response` を返す型にする。
 */
export const controller = {
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
  listMine: async (c: Context, userId: number, query: ListMineQuerySchemaType): Promise<TypedResponse<ListDtoType, 200, 'json'>> => {
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
}
