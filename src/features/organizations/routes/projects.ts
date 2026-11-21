import { createRoute, OpenAPIHono } from '@hono/zod-openapi'

import { authMiddleware } from '@/middlewares/auth'
import { organizationMembershipMiddleware } from '@/middlewares/organizationMembership'
import { organizationAdminMiddleware } from '@/middlewares/organizationRole'
import { paramValidationMiddleware } from '@/middlewares/paramValidation'
import { openApiDefaultHook } from '@/utils/validation'

import { projectsController } from '../controllers/projects'
import { tasksController } from '../controllers/tasks'
import { itemDto, listDto } from '../dtos/projects'
import { itemDto as taskDto, listDto as taskListDto } from '../dtos/tasks'
import { collectionParamSchema, createBodySchema, itemParamSchema, listQuerySchema, updateBodySchema } from '../schemas/projects'
import {
  collectionParamSchema as taskCollectionParamSchema,
  createBodySchema as createTaskBodySchema,
  itemParamSchema as taskItemParamSchema,
  listQuerySchema as taskListQuerySchema,
  updateBodySchema as updateTaskBodySchema,
} from '../schemas/tasks'
import { bearerSecurity, errorResponse } from './common'

/**
 * GET /organizations/{id}/projects: 組織のプロジェクト一覧を新しい順に返す。組織メンバーなら閲覧可。
 * 認証 → パス検証 → 所属確認 → query検証の順に実行する。
 */
const listProjectsRoute = createRoute({
  method: 'get',
  path: '/{id}/projects',
  tags: ['Organization Projects'],
  summary: '指定した組織のプロジェクト一覧を取得する',
  description:
    '作成日時・IDの新しい順（createdAt DESC, id DESC）で返す。カーソル式ページネーションで、nextCursorは後続がある場合のみ返す。ページ間のスナップショット一貫性は保証しない。',
  middleware: [authMiddleware, paramValidationMiddleware(collectionParamSchema), organizationMembershipMiddleware],
  security: bearerSecurity,
  request: {
    params: collectionParamSchema,
    query: listQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: listDto } },
      description: '組織のプロジェクト一覧（新しい順、カーソル式ページネーション）',
    },
    400: errorResponse('組織ID、query、またはカーソルが不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    404: errorResponse('組織が見つからない、または所属していない'),
    500: errorResponse('サーバーエラー'),
  },
})

/**
 * POST /organizations/{id}/projects: プロジェクトを作成する。OWNER / ADMINのみ。
 * 認証 → パス検証 → 所属確認 → ロール確認 → body検証の順に実行する（MEMBERは不正bodyでも403）。
 */
const createProjectRoute = createRoute({
  method: 'post',
  path: '/{id}/projects',
  tags: ['Organization Projects'],
  summary: '指定した組織にプロジェクトを作成する',
  middleware: [authMiddleware, paramValidationMiddleware(collectionParamSchema), organizationMembershipMiddleware, organizationAdminMiddleware],
  security: bearerSecurity,
  request: {
    params: collectionParamSchema,
    body: {
      // required: true を付けないと、Content-Typeなし/bodyなしのPOSTが任意bodyとして
      // 検証スキップされ c.req.valid('json') が {} になり必須body検証（400）を維持できない。
      required: true,
      content: { 'application/json': { schema: createBodySchema } },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: itemDto } },
      description: '作成されたプロジェクト',
    },
    400: errorResponse('入力値が不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    403: errorResponse('権限が不足（OWNER / ADMIN のみ作成可）'),
    404: errorResponse('組織が見つからない、または所属していない'),
    500: errorResponse('サーバーエラー'),
  },
})

/** GET /organizations/{id}/projects/{projectId}: 組織内のプロジェクトを1件返す。組織メンバーなら閲覧可。 */
const getProjectRoute = createRoute({
  method: 'get',
  path: '/{id}/projects/{projectId}',
  tags: ['Organization Projects'],
  summary: '指定したプロジェクトを取得する',
  middleware: [authMiddleware, paramValidationMiddleware(itemParamSchema), organizationMembershipMiddleware],
  security: bearerSecurity,
  request: {
    params: itemParamSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: itemDto } },
      description: '指定プロジェクト',
    },
    400: errorResponse('パスパラメータが不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    404: errorResponse('組織またはプロジェクトが見つからない（別組織のプロジェクトIDを含む）'),
    500: errorResponse('サーバーエラー'),
  },
})

/**
 * PATCH /organizations/{id}/projects/{projectId}: プロジェクトを部分更新する。OWNER / ADMINのみ。
 * 認証 → パス検証 → 所属確認 → ロール確認 → body検証の順に実行する（MEMBERは不正bodyでも403）。
 */
const updateProjectRoute = createRoute({
  method: 'patch',
  path: '/{id}/projects/{projectId}',
  tags: ['Organization Projects'],
  summary: '指定したプロジェクトを部分更新する',
  description: 'name / description のうち指定した項目だけを更新する。description: null は説明の削除。同値の指定でも updatedAt は更新される。',
  middleware: [authMiddleware, paramValidationMiddleware(itemParamSchema), organizationMembershipMiddleware, organizationAdminMiddleware],
  security: bearerSecurity,
  request: {
    params: itemParamSchema,
    body: {
      // required: true を付けないと、Content-Typeなし/bodyなしのPATCHが任意bodyとして
      // 検証スキップされ c.req.valid('json') が {} になり必須body検証（400）を維持できない。
      required: true,
      content: { 'application/json': { schema: updateBodySchema } },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: itemDto } },
      description: '更新後のプロジェクト',
    },
    400: errorResponse('入力値が不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    403: errorResponse('権限が不足（OWNER / ADMIN のみ更新可）'),
    404: errorResponse('組織またはプロジェクトが見つからない（別組織のプロジェクトIDを含む）'),
    500: errorResponse('サーバーエラー'),
  },
})

/**
 * DELETE /organizations/{id}/projects/{projectId}: プロジェクトを完全削除する。OWNER / ADMINのみ。
 * MEMBERは対象の有無にかかわらず403とし、対象の存在を漏らさない。
 */
const removeProjectRoute = createRoute({
  method: 'delete',
  path: '/{id}/projects/{projectId}',
  tags: ['Organization Projects'],
  summary: '指定したプロジェクトを完全削除する',
  middleware: [authMiddleware, paramValidationMiddleware(itemParamSchema), organizationMembershipMiddleware, organizationAdminMiddleware],
  security: bearerSecurity,
  request: {
    params: itemParamSchema,
  },
  responses: {
    204: {
      description: '削除に成功（本文なし）',
    },
    400: errorResponse('パスパラメータが不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    403: errorResponse('権限が不足（OWNER / ADMIN のみ削除可）'),
    404: errorResponse('組織またはプロジェクトが見つからない（削除済み、別組織のプロジェクトIDを含む）'),
    500: errorResponse('サーバーエラー'),
  },
})

/**
 * GET /organizations/{id}/projects/{projectId}/tasks: プロジェクトのタスク一覧を新しい順に返す。組織メンバーなら閲覧可。
 * 認証 → パス検証 → 所属確認 → query検証の順に実行する。
 */
const listTasksRoute = createRoute({
  method: 'get',
  path: '/{id}/projects/{projectId}/tasks',
  tags: ['Organization Project Tasks'],
  summary: '指定したプロジェクトのタスク一覧を取得する',
  description:
    '作成日時・IDの新しい順（createdAt DESC, id DESC）で返す。statusを指定するとその状態のタスクだけを返す。カーソル式ページネーションで、nextCursorは後続がある場合のみ返す。カーソルは発行時の組織・プロジェクト・statusでのみ使用でき、ページ間のスナップショット一貫性は保証しない。',
  middleware: [authMiddleware, paramValidationMiddleware(taskCollectionParamSchema), organizationMembershipMiddleware],
  security: bearerSecurity,
  request: {
    params: taskCollectionParamSchema,
    query: taskListQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: taskListDto } },
      description: 'プロジェクトのタスク一覧（新しい順、カーソル式ページネーション）',
    },
    400: errorResponse('パスパラメータ、query、またはカーソルが不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    404: errorResponse('組織またはプロジェクトが見つからない（別組織のプロジェクトIDを含む）、または組織に所属していない'),
    500: errorResponse('サーバーエラー'),
  },
})

/**
 * POST /organizations/{id}/projects/{projectId}/tasks: タスクを作成する。組織メンバー（OWNER / ADMIN / MEMBER）なら可。
 * 認証 → パス検証 → 所属確認 → body検証の順に実行する。
 */
const createTaskRoute = createRoute({
  method: 'post',
  path: '/{id}/projects/{projectId}/tasks',
  tags: ['Organization Project Tasks'],
  summary: '指定したプロジェクトにタスクを作成する',
  middleware: [authMiddleware, paramValidationMiddleware(taskCollectionParamSchema), organizationMembershipMiddleware],
  security: bearerSecurity,
  request: {
    params: taskCollectionParamSchema,
    body: {
      // required: true を付けないと、Content-Typeなし/bodyなしのPOSTが任意bodyとして
      // 検証スキップされ c.req.valid('json') が {} になり必須body検証（400）を維持できない。
      required: true,
      content: { 'application/json': { schema: createTaskBodySchema } },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: taskDto } },
      description: '作成されたタスク',
    },
    400: errorResponse('入力値が不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    404: errorResponse('組織またはプロジェクトが見つからない（別組織のプロジェクトIDを含む）、または組織に所属していない'),
    500: errorResponse('サーバーエラー'),
  },
})

/** GET /organizations/{id}/projects/{projectId}/tasks/{taskId}: プロジェクト内のタスクを1件返す。組織メンバーなら閲覧可。 */
const getTaskRoute = createRoute({
  method: 'get',
  path: '/{id}/projects/{projectId}/tasks/{taskId}',
  tags: ['Organization Project Tasks'],
  summary: '指定したタスクを取得する',
  middleware: [authMiddleware, paramValidationMiddleware(taskItemParamSchema), organizationMembershipMiddleware],
  security: bearerSecurity,
  request: {
    params: taskItemParamSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: taskDto } },
      description: '指定タスク',
    },
    400: errorResponse('パスパラメータが不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    404: errorResponse('組織・プロジェクト・タスクが見つからない（別組織のプロジェクトID・別プロジェクトのタスクIDを含む）、または組織に所属していない'),
    500: errorResponse('サーバーエラー'),
  },
})

/**
 * PATCH /organizations/{id}/projects/{projectId}/tasks/{taskId}: タスクを部分更新する（状態変更を含む）。組織メンバーなら可。
 * 認証 → パス検証 → 所属確認 → body検証の順に実行する。
 */
const updateTaskRoute = createRoute({
  method: 'patch',
  path: '/{id}/projects/{projectId}/tasks/{taskId}',
  tags: ['Organization Project Tasks'],
  summary: '指定したタスクを部分更新する',
  description:
    'title / description / status のうち指定した項目だけを更新する。description: null は説明の削除。title: null と status: null は不正。同値の指定でも updatedAt は更新される。',
  middleware: [authMiddleware, paramValidationMiddleware(taskItemParamSchema), organizationMembershipMiddleware],
  security: bearerSecurity,
  request: {
    params: taskItemParamSchema,
    body: {
      // required: true を付けないと、Content-Typeなし/bodyなしのPATCHが任意bodyとして
      // 検証スキップされ c.req.valid('json') が {} になり必須body検証（400）を維持できない。
      required: true,
      content: { 'application/json': { schema: updateTaskBodySchema } },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: taskDto } },
      description: '更新後のタスク',
    },
    400: errorResponse('入力値が不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    404: errorResponse('組織・プロジェクト・タスクが見つからない（別組織のプロジェクトID・別プロジェクトのタスクIDを含む）、または組織に所属していない'),
    500: errorResponse('サーバーエラー'),
  },
})

/**
 * DELETE /organizations/{id}/projects/{projectId}/tasks/{taskId}: タスクを完全削除する。OWNER / ADMINのみ。
 * MEMBERはパス検証・所属確認の後、親ProjectやTaskの有無にかかわらず403とし、対象の存在を漏らさない。
 */
const removeTaskRoute = createRoute({
  method: 'delete',
  path: '/{id}/projects/{projectId}/tasks/{taskId}',
  tags: ['Organization Project Tasks'],
  summary: '指定したタスクを完全削除する',
  middleware: [authMiddleware, paramValidationMiddleware(taskItemParamSchema), organizationMembershipMiddleware, organizationAdminMiddleware],
  security: bearerSecurity,
  request: {
    params: taskItemParamSchema,
  },
  responses: {
    204: {
      description: '削除に成功（本文なし）',
    },
    400: errorResponse('パスパラメータが不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    403: errorResponse('権限が不足（OWNER / ADMIN のみ削除可）'),
    404: errorResponse(
      '組織・プロジェクト・タスクが見つからない（削除済み、別組織のプロジェクトID・別プロジェクトのタスクIDを含む）、または組織に所属していない',
    ),
    500: errorResponse('サーバーエラー'),
  },
})

/**
 * 組織配下のプロジェクトのルート（`/organizations/{id}/projects` 配下）と、プロジェクト配下のタスクのルート。
 * プロジェクトのルートは `/{id}/projects/{projectId}` までで、タスクのルートは `/{id}/projects/{projectId}/tasks` 配下のため、パスは衝突しない。
 * プロジェクトの書き込み系は、body検証より先にロール確認（403）を確定するため `organizationAdminMiddleware` を適用する。
 * タスクは全ロールが閲覧・作成・更新でき、削除だけ `organizationAdminMiddleware` を適用する。
 * トランザクション内の最新所属・ロールの再判定は、serviceとrepositoryが行う。
 */
export const projectsRoutes = new OpenAPIHono({ defaultHook: openApiDefaultHook })
  .openapi(listProjectsRoute, (c) => projectsController.list(c, c.req.valid('param').id, c.req.valid('query')))
  .openapi(createProjectRoute, (c) => projectsController.create(c, c.req.valid('param').id, c.get('userId'), c.req.valid('json')))
  .openapi(getProjectRoute, (c) => projectsController.getById(c, c.req.valid('param').id, c.req.valid('param').projectId))
  .openapi(updateProjectRoute, (c) =>
    projectsController.update(c, c.req.valid('param').id, c.req.valid('param').projectId, c.get('userId'), c.req.valid('json')),
  )
  .openapi(removeProjectRoute, (c) => projectsController.remove(c, c.req.valid('param').id, c.req.valid('param').projectId, c.get('userId')))
  .openapi(listTasksRoute, (c) => tasksController.list(c, c.req.valid('param').id, c.req.valid('param').projectId, c.req.valid('query')))
  .openapi(createTaskRoute, (c) => tasksController.create(c, c.req.valid('param').id, c.req.valid('param').projectId, c.get('userId'), c.req.valid('json')))
  .openapi(getTaskRoute, (c) => tasksController.getById(c, c.req.valid('param').id, c.req.valid('param').projectId, c.req.valid('param').taskId))
  .openapi(updateTaskRoute, (c) =>
    tasksController.update(c, c.req.valid('param').id, c.req.valid('param').projectId, c.req.valid('param').taskId, c.get('userId'), c.req.valid('json')),
  )
  .openapi(removeTaskRoute, (c) =>
    tasksController.remove(c, c.req.valid('param').id, c.req.valid('param').projectId, c.req.valid('param').taskId, c.get('userId')),
  )
