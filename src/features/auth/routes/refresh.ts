import { createRoute, OpenAPIHono } from '@hono/zod-openapi'

import { originMiddleware } from '@/middlewares/origin'
import { authResultDto } from '@/shared/auth/dtos'
import { openApiDefaultHook } from '@/utils/validation'

import { refreshController } from '../controllers/refresh'
import { cookieSecurity, errorResponse } from './common'

/** POST /auth/refresh: Cookieのリフレッシュトークンをローテーションしてアクセストークンを再発行する。 */
const refreshRoute = createRoute({
  method: 'post',
  path: '/refresh',
  tags: ['Auth'],
  summary: 'リフレッシュトークンをローテーションしてアクセストークンを再発行する',
  middleware: [originMiddleware],
  security: cookieSecurity,
  responses: {
    200: {
      content: { 'application/json': { schema: authResultDto } },
      description: 'ローテーション結果',
    },
    401: errorResponse('リフレッシュトークンが無効'),
    403: errorResponse('許可されていないOrigin'),
    500: errorResponse('サーバーエラー'),
  },
})

/**
 * リフレッシュトークンのローテーションのルート（`/auth/refresh`）。
 */
export const refreshRoutes = new OpenAPIHono({ defaultHook: openApiDefaultHook }).openapi(refreshRoute, (c) => refreshController.execute(c))
