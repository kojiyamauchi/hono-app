import { createRoute, OpenAPIHono } from '@hono/zod-openapi'

import { authMiddleware } from '@/middlewares/auth'
import { organizationMembershipMiddleware } from '@/middlewares/organizationMembership'
import { organizationAdminMiddleware } from '@/middlewares/organizationRole'
import { paramValidationMiddleware } from '@/middlewares/paramValidation'
import { errorResponseDto } from '@/shared/openApi/dtos'
import { SECURITY_SCHEME } from '@/shared/openApi/schemes'
import { openApiDefaultHook } from '@/utils/validation'

import { organizationsProjectsController } from '../controllers/projects'
import { projectDto, projectListDto } from '../dtos/projects'
import {
  createProjectBodySchema,
  listProjectsQuerySchema,
  projectRouteParamSchema,
  projectsRouteParamSchema,
  updateProjectBodySchema,
} from '../schemas/projects'

/** JSONエラーレスポンス（`{ error: { message } }`）の共通定義を生成する。 */
const errorResponse = (description: string): { content: { 'application/json': { schema: typeof errorResponseDto } }; description: string } => ({
  content: { 'application/json': { schema: errorResponseDto } },
  description,
})

/** プロジェクトAPIに共通するsecurity（Bearerアクセストークン）。 */
const bearerSecurity = [{ [SECURITY_SCHEME.bearer]: [] }]

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
  middleware: [authMiddleware, paramValidationMiddleware(projectsRouteParamSchema), organizationMembershipMiddleware],
  security: bearerSecurity,
  request: {
    params: projectsRouteParamSchema,
    query: listProjectsQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: projectListDto } },
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
  middleware: [authMiddleware, paramValidationMiddleware(projectsRouteParamSchema), organizationMembershipMiddleware, organizationAdminMiddleware],
  security: bearerSecurity,
  request: {
    params: projectsRouteParamSchema,
    body: {
      // required: true を付けないと、Content-Typeなし/bodyなしのPOSTが任意bodyとして
      // 検証スキップされ c.req.valid('json') が {} になり必須body検証（400）を維持できない。
      required: true,
      content: { 'application/json': { schema: createProjectBodySchema } },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: projectDto } },
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
  middleware: [authMiddleware, paramValidationMiddleware(projectRouteParamSchema), organizationMembershipMiddleware],
  security: bearerSecurity,
  request: {
    params: projectRouteParamSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: projectDto } },
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
  middleware: [authMiddleware, paramValidationMiddleware(projectRouteParamSchema), organizationMembershipMiddleware, organizationAdminMiddleware],
  security: bearerSecurity,
  request: {
    params: projectRouteParamSchema,
    body: {
      // required: true を付けないと、Content-Typeなし/bodyなしのPATCHが任意bodyとして
      // 検証スキップされ c.req.valid('json') が {} になり必須body検証（400）を維持できない。
      required: true,
      content: { 'application/json': { schema: updateProjectBodySchema } },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: projectDto } },
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
  middleware: [authMiddleware, paramValidationMiddleware(projectRouteParamSchema), organizationMembershipMiddleware, organizationAdminMiddleware],
  security: bearerSecurity,
  request: {
    params: projectRouteParamSchema,
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
 * 組織配下のプロジェクトのルート（`/organizations/{id}/projects` 配下）。
 * 書き込み系は、body検証より先にロール確認（403）を確定するため `organizationAdminMiddleware` を適用する。
 * トランザクション内の最新所属・ロールの再判定は、serviceとrepositoryが行う。
 */
export const organizationsProjectsRoutes = new OpenAPIHono({ defaultHook: openApiDefaultHook })
  .openapi(listProjectsRoute, (c) => organizationsProjectsController.list(c, c.req.valid('param').id, c.req.valid('query')))
  .openapi(createProjectRoute, (c) => organizationsProjectsController.create(c, c.req.valid('param').id, c.get('userId'), c.req.valid('json')))
  .openapi(getProjectRoute, (c) => organizationsProjectsController.getById(c, c.req.valid('param').id, c.req.valid('param').projectId))
  .openapi(updateProjectRoute, (c) =>
    organizationsProjectsController.update(c, c.req.valid('param').id, c.req.valid('param').projectId, c.get('userId'), c.req.valid('json')),
  )
  .openapi(removeProjectRoute, (c) => organizationsProjectsController.remove(c, c.req.valid('param').id, c.req.valid('param').projectId, c.get('userId')))
