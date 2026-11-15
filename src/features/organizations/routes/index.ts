import { createRoute, OpenAPIHono } from '@hono/zod-openapi'

import { authMiddleware } from '@/middlewares/auth'
import { organizationMembershipMiddleware } from '@/middlewares/organizationMembership'
import { paramValidationMiddleware } from '@/middlewares/paramValidation'
import { organizationDto } from '@/shared/organization/dtos'
import { openApiDefaultHook } from '@/utils/validation'

import { controller } from '../controllers'
import { listDto } from '../dtos'
import { createSchema, listMineQuerySchema, updateSchema } from '../schemas'
import { idParamSchema } from '../schemas/common'
import { auditLogsRoutes } from './auditLogs'
import { bearerSecurity, errorResponse } from './common'
import { invitationsRoutes } from './invitations'
import { membersRoutes } from './members'
import { projectsRoutes } from './projects'
import { transferOwnershipRoutes } from './transferOwnership'

/** POST /organizations: 組織を作成する。 */
const createRouteDef = createRoute({
  method: 'post',
  path: '/',
  tags: ['Organizations'],
  summary: '組織を作成する',
  middleware: [authMiddleware],
  security: bearerSecurity,
  request: {
    body: {
      // required: true を付けないと、Content-Typeなし/bodyなしのPOSTが任意bodyとして
      // 検証スキップされ c.req.valid('json') が {} になり400が返らなくなる。既存の必須body検証を維持する。
      required: true,
      content: { 'application/json': { schema: createSchema } },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: organizationDto } },
      description: '作成された組織',
    },
    400: errorResponse('入力値が不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    500: errorResponse('サーバーエラー'),
  },
})

/** GET /organizations: 認証済みユーザーが所属する組織の一覧を返す。 */
const listMineRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Organizations'],
  summary: '認証済みユーザーが所属する組織の一覧を取得する',
  middleware: [authMiddleware],
  security: bearerSecurity,
  request: {
    query: listMineQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: listDto } },
      description: '所属組織の一覧（オフセット式ページネーション）',
    },
    400: errorResponse('queryが不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    500: errorResponse('サーバーエラー'),
  },
})

/** GET /organizations/{id}: 指定IDの組織情報を返す。 */
const getByIdRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Organizations'],
  summary: '指定した組織の情報を取得する',
  middleware: [authMiddleware, paramValidationMiddleware(idParamSchema), organizationMembershipMiddleware],
  security: bearerSecurity,
  request: {
    params: idParamSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: organizationDto } },
      description: '指定組織の情報',
    },
    400: errorResponse('組織IDが不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    404: errorResponse('組織が見つからない'),
    500: errorResponse('サーバーエラー'),
  },
})

/** PATCH /organizations/{id}: 組織を更新する。 */
const updateRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Organizations'],
  summary: '指定した組織を更新する',
  middleware: [authMiddleware, paramValidationMiddleware(idParamSchema), organizationMembershipMiddleware],
  security: bearerSecurity,
  request: {
    params: idParamSchema,
    body: {
      // required: true を付けないと、Content-Typeなし/bodyなしのPATCHが任意bodyとして
      // 検証スキップされ c.req.valid('json') が {} になり既存の必須body検証（400）を維持できない。
      required: true,
      content: { 'application/json': { schema: updateSchema } },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: organizationDto } },
      description: '更新後の組織情報',
    },
    400: errorResponse('入力値が不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    403: errorResponse('権限が不足'),
    404: errorResponse('組織が見つからない'),
    500: errorResponse('サーバーエラー'),
  },
})

/** DELETE /organizations/{id}: 組織を削除する。 */
const removeRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Organizations'],
  summary: '指定した組織を削除する',
  middleware: [authMiddleware, paramValidationMiddleware(idParamSchema), organizationMembershipMiddleware],
  security: bearerSecurity,
  request: {
    params: idParamSchema,
  },
  responses: {
    204: {
      description: '処理を受理',
    },
    400: errorResponse('組織IDが不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    403: errorResponse('権限が不足'),
    404: errorResponse('組織が見つからない'),
    500: errorResponse('サーバーエラー'),
  },
})

/**
 * 組織関連のルート（/organizations配下）。
 * すべて認証が必要。`/:id` 系は組織メンバーシップの確認も行う。
 * バリデーションエラー時は defaultHook で既存と同じ `{ error: { message } }`（400）を返す。
 * 認証・パス検証・所属確認などのmiddlewareは、各ルートの `createRoute` の `middleware` で個別に適用する。
 * 静的パス（`/`）→ `/{id}` → `/{id}/transfer-ownership` → `/{id}/members` 系 → `/{id}/audit-logs` → `/{id}/invitations` 系の順で登録し、
 * 最後に `/{id}/projects` 系をmountする。
 */
export const organizationsRoutes = new OpenAPIHono({ defaultHook: openApiDefaultHook })
  .openapi(createRouteDef, (c) => controller.create(c, c.get('userId'), c.req.valid('json')))
  .openapi(listMineRoute, (c) => controller.listMine(c, c.get('userId'), c.req.valid('query')))
  .openapi(getByIdRoute, (c) => controller.getById(c, c.req.valid('param').id))
  .openapi(updateRoute, (c) => controller.update(c, c.req.valid('param').id, c.req.valid('json'), c.get('membership').role))
  .openapi(removeRoute, (c) => controller.remove(c, c.req.valid('param').id, c.get('membership').role))
  .route('/', transferOwnershipRoutes)
  .route('/', membersRoutes)
  .route('/', auditLogsRoutes)
  .route('/', invitationsRoutes)
  .route('/', projectsRoutes)
