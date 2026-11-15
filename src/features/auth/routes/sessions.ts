import { createRoute, OpenAPIHono } from '@hono/zod-openapi'

import { authMiddleware } from '@/middlewares/auth'
import { originMiddleware } from '@/middlewares/origin'
import { openApiDefaultHook } from '@/utils/validation'

import { sessionsController } from '../controllers/sessions'
import { listDto } from '../dtos/sessions'
import { itemParamSchema } from '../schemas/sessions'
import { bearerSecurity, errorResponse } from './common'

/** GET /auth/sessions: 認証済みユーザーのリフレッシュセッション一覧を取得する。 */
const listSessionsRoute = createRoute({
  method: 'get',
  path: '/sessions',
  tags: ['Auth'],
  summary: '認証済みユーザーのリフレッシュセッション一覧を取得する',
  middleware: [authMiddleware],
  security: bearerSecurity,
  responses: {
    200: {
      content: { 'application/json': { schema: listDto } },
      description: 'activeなリフレッシュセッション一覧',
    },
    401: errorResponse('認証が必要、またはトークンが無効'),
    500: errorResponse('サーバーエラー'),
  },
})

/** DELETE /auth/sessions/{id}: 認証済みユーザー自身の指定リフレッシュセッションを失効する。 */
const logoutSessionRoute = createRoute({
  method: 'delete',
  path: '/sessions/{id}',
  tags: ['Auth'],
  summary: '認証済みユーザー自身の指定リフレッシュセッションを失効する',
  middleware: [originMiddleware, authMiddleware],
  security: bearerSecurity,
  request: {
    params: itemParamSchema,
  },
  responses: {
    204: {
      description: '処理を受理',
    },
    400: errorResponse('セッションIDの形式が不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    403: errorResponse('許可されていないOrigin'),
    404: errorResponse('対象が見つからない'),
    500: errorResponse('サーバーエラー'),
  },
})

/**
 * リフレッシュセッションのルート（`/auth/sessions`）。
 * `/sessions` を `/sessions/{id}` より先に登録し、静的パスを優先する。
 */
export const sessionsRoutes = new OpenAPIHono({ defaultHook: openApiDefaultHook })
  .openapi(listSessionsRoute, (c) => sessionsController.list(c, c.get('userId')))
  .openapi(logoutSessionRoute, (c) => sessionsController.revoke(c, c.get('userId'), c.req.valid('param')))
