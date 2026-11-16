import { createRoute, OpenAPIHono } from '@hono/zod-openapi'

import { authMiddleware } from '@/middlewares/auth'
import { organizationMembershipMiddleware } from '@/middlewares/organizationMembership'
import { paramValidationMiddleware } from '@/middlewares/paramValidation'
import { openApiDefaultHook } from '@/utils/validation'

import { transferOwnershipController } from '../controllers/transferOwnership'
import { idParamSchema } from '../schemas/common'
import { bodySchema } from '../schemas/transferOwnership'
import { bearerSecurity, errorResponse } from './common'

/** POST /organizations/{id}/transfer-ownership: 組織の所有権を既存メンバーへ移譲する。 */
const transferOwnershipRoute = createRoute({
  method: 'post',
  path: '/{id}/transfer-ownership',
  tags: ['Organizations'],
  summary: '組織の所有権を既存メンバーへ移譲する',
  middleware: [authMiddleware, paramValidationMiddleware(idParamSchema), organizationMembershipMiddleware],
  security: bearerSecurity,
  request: {
    params: idParamSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: bodySchema } },
    },
  },
  responses: {
    204: {
      description: '所有権の移譲に成功',
    },
    400: errorResponse('入力値が不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    403: errorResponse('OWNER権限が必要'),
    404: errorResponse('組織または移譲先メンバーが見つからない'),
    409: errorResponse('競合により移譲できない'),
    422: errorResponse('自分自身への移譲など意味的に不正な入力'),
    500: errorResponse('サーバーエラー'),
  },
})

/** 組織の所有権移譲のルート（`/organizations/{id}/transfer-ownership`）。 */
export const transferOwnershipRoutes = new OpenAPIHono({ defaultHook: openApiDefaultHook }).openapi(transferOwnershipRoute, (c) =>
  transferOwnershipController.execute(c, c.req.valid('param').id, c.get('userId'), c.get('membership').role, c.req.valid('json')),
)
