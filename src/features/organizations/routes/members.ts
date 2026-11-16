import { createRoute, OpenAPIHono } from '@hono/zod-openapi'

import { authMiddleware } from '@/middlewares/auth'
import { organizationMembershipMiddleware } from '@/middlewares/organizationMembership'
import { paramValidationMiddleware } from '@/middlewares/paramValidation'
import { memberDto } from '@/shared/membership/dtos'
import { openApiDefaultHook } from '@/utils/validation'

import { membersController } from '../controllers/members'
import { listDto } from '../dtos/members'
import { idParamSchema } from '../schemas/common'
import { addBodySchema, itemParamSchema, listQuerySchema, updateRoleBodySchema } from '../schemas/members'
import { bearerSecurity, errorResponse } from './common'

/** GET /organizations/{id}/members: 組織のメンバー一覧を返す。 */
const listMembersRoute = createRoute({
  method: 'get',
  path: '/{id}/members',
  tags: ['Organization Members'],
  summary: '指定した組織のメンバー一覧を取得する',
  middleware: [authMiddleware, paramValidationMiddleware(idParamSchema), organizationMembershipMiddleware],
  security: bearerSecurity,
  request: {
    params: idParamSchema,
    query: listQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: listDto } },
      description: '組織のメンバー一覧（カーソル式ページネーション）',
    },
    400: errorResponse('組織IDまたはqueryが不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    404: errorResponse('組織が見つからない'),
    500: errorResponse('サーバーエラー'),
  },
})

/** POST /organizations/{id}/members: メンバーを追加する。 */
const addMemberRoute = createRoute({
  method: 'post',
  path: '/{id}/members',
  tags: ['Organization Members'],
  summary: '指定した組織へメンバーを追加する',
  middleware: [authMiddleware, paramValidationMiddleware(idParamSchema), organizationMembershipMiddleware],
  security: bearerSecurity,
  request: {
    params: idParamSchema,
    body: {
      // required: true を付けないと、Content-Typeなし/bodyなしのPOSTが任意bodyとして
      // 検証スキップされ c.req.valid('json') が {} になり既存の必須body検証（400）を維持できない。
      required: true,
      content: { 'application/json': { schema: addBodySchema } },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: memberDto } },
      description: '追加されたメンバー',
    },
    400: errorResponse('入力値が不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    403: errorResponse('権限が不足'),
    404: errorResponse('組織が見つからない'),
    409: errorResponse('既にメンバー'),
    422: errorResponse('意味的に不正な入力（例: OWNERロール指定）'),
    500: errorResponse('サーバーエラー'),
  },
})

/** DELETE /organizations/{id}/members/me: 認証ユーザー自身を組織から脱退させる。 */
const leaveOrganizationRoute = createRoute({
  method: 'delete',
  path: '/{id}/members/me',
  tags: ['Organization Members'],
  summary: '認証ユーザー自身を指定した組織から脱退させる',
  middleware: [authMiddleware, paramValidationMiddleware(idParamSchema), organizationMembershipMiddleware],
  security: bearerSecurity,
  request: {
    params: idParamSchema,
  },
  responses: {
    204: {
      description: '組織からの脱退に成功',
    },
    400: errorResponse('組織IDが不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    404: errorResponse('組織が見つからない'),
    409: errorResponse('OWNERのため脱退できない、または競合により脱退できない'),
    500: errorResponse('サーバーエラー'),
  },
})

/** PATCH /organizations/{id}/members/{membershipId}: メンバーのロールを変更する。 */
const updateMemberRoleRoute = createRoute({
  method: 'patch',
  path: '/{id}/members/{membershipId}',
  tags: ['Organization Members'],
  summary: '指定したメンバーのロールを変更する',
  middleware: [authMiddleware, paramValidationMiddleware(itemParamSchema), organizationMembershipMiddleware],
  security: bearerSecurity,
  request: {
    params: itemParamSchema,
    body: {
      // required: true を付けないと、Content-Typeなし/bodyなしのPATCHが任意bodyとして
      // 検証スキップされ c.req.valid('json') が {} になり既存の必須body検証（400）を維持できない。
      required: true,
      content: { 'application/json': { schema: updateRoleBodySchema } },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: memberDto } },
      description: '変更後のメンバー情報',
    },
    400: errorResponse('入力値が不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    403: errorResponse('権限が不足'),
    404: errorResponse('組織またはメンバーが見つからない'),
    409: errorResponse('対象がOWNERなど変更不可'),
    422: errorResponse('意味的に不正な入力（例: OWNERロール指定）'),
    500: errorResponse('サーバーエラー'),
  },
})

/** DELETE /organizations/{id}/members/{membershipId}: メンバーを削除する。 */
const removeMemberRoute = createRoute({
  method: 'delete',
  path: '/{id}/members/{membershipId}',
  tags: ['Organization Members'],
  summary: '指定したメンバーを削除し、監査ログ（MEMBER_REMOVED）に記録する',
  middleware: [authMiddleware, paramValidationMiddleware(itemParamSchema), organizationMembershipMiddleware],
  security: bearerSecurity,
  request: {
    params: itemParamSchema,
  },
  responses: {
    204: {
      description: '処理を受理',
    },
    400: errorResponse('パスパラメータが不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    403: errorResponse('権限が不足'),
    404: errorResponse('組織またはメンバーが見つからない'),
    409: errorResponse('対象がOWNERなど削除不可'),
    500: errorResponse('サーバーエラー（監査ログの記録に失敗した場合を含む。その場合は削除もロールバックされる）'),
  },
})

/**
 * 組織メンバーのルート（`/organizations/{id}/members` 配下）。
 * 静的パス `/members/me`（脱退）を、動的パス `/members/{membershipId}` より先に登録して、同method・同階層の解決結果を維持する。
 */
export const membersRoutes = new OpenAPIHono({ defaultHook: openApiDefaultHook })
  .openapi(listMembersRoute, (c) => membersController.list(c, c.req.valid('param').id, c.req.valid('query')))
  .openapi(addMemberRoute, (c) => membersController.add(c, c.req.valid('param').id, c.get('membership').role, c.req.valid('json')))
  .openapi(leaveOrganizationRoute, (c) => membersController.leave(c, c.req.valid('param').id, c.get('userId')))
  .openapi(updateMemberRoleRoute, (c) =>
    membersController.updateRole(c, c.req.valid('param').id, c.req.valid('param').membershipId, c.get('userId'), c.get('membership').role, c.req.valid('json')),
  )
  .openapi(removeMemberRoute, (c) => membersController.remove(c, c.req.valid('param').id, c.req.valid('param').membershipId, c.get('userId')))
