import { createRoute, OpenAPIHono } from '@hono/zod-openapi'

import { authMiddleware } from '@/middlewares/auth'
import { originMiddleware } from '@/middlewares/origin'
import { openApiDefaultHook } from '@/utils/validation'

import { logoutAllController } from '../controllers/logoutAll'
import { bearerSecurity, errorResponse } from './common'

/** POST /auth/logout-all: 認証済みユーザーの全リフレッシュセッションを失効する。 */
const logoutAllRoute = createRoute({
  method: 'post',
  path: '/logout-all',
  tags: ['Auth'],
  summary: '認証済みユーザーの全リフレッシュセッションを失効する',
  middleware: [originMiddleware, authMiddleware],
  security: bearerSecurity,
  responses: {
    204: {
      description: '処理を受理',
    },
    401: errorResponse('認証が必要、またはトークンが無効'),
    403: errorResponse('許可されていないOrigin'),
    500: errorResponse('サーバーエラー'),
  },
})

/**
 * 全セッションログアウトのルート（`/auth/logout-all`）。
 */
export const logoutAllRoutes = new OpenAPIHono({ defaultHook: openApiDefaultHook }).openapi(logoutAllRoute, (c) =>
  logoutAllController.execute(c, c.get('userId')),
)
