import { createRoute, OpenAPIHono } from '@hono/zod-openapi'

import { originMiddleware } from '@/middlewares/origin'
import { openApiDefaultHook } from '@/utils/validation'

import { logoutController } from '../controllers/logout'
import { cookieSecurity, errorResponse } from './common'

/** POST /auth/logout: Cookieのリフレッシュトークンに対応するログインセッションを失効する。 */
const logoutRoute = createRoute({
  method: 'post',
  path: '/logout',
  tags: ['Auth'],
  summary: 'リフレッシュトークンに対応するログインセッションを失効する',
  middleware: [originMiddleware],
  security: cookieSecurity,
  responses: {
    204: {
      description: '処理を受理',
    },
    403: errorResponse('許可されていないOrigin'),
    500: errorResponse('サーバーエラー'),
  },
})

/**
 * ログアウトのルート（`/auth/logout`）。
 */
export const logoutRoutes = new OpenAPIHono({ defaultHook: openApiDefaultHook }).openapi(logoutRoute, (c) => logoutController.execute(c))
