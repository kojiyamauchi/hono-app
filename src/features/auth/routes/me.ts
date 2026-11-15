import { createRoute, OpenAPIHono } from '@hono/zod-openapi'

import { authMiddleware } from '@/middlewares/auth'
import { userDto } from '@/shared/user/dtos'
import { openApiDefaultHook } from '@/utils/validation'

import { meController } from '../controllers/me'
import { bearerSecurity, errorResponse } from './common'

/** GET /auth/me: 認証済みユーザー自身の情報を返す。 */
const meRoute = createRoute({
  method: 'get',
  path: '/me',
  tags: ['Auth'],
  summary: '認証トークンに紐づくユーザー情報を取得する',
  middleware: [authMiddleware],
  security: bearerSecurity,
  responses: {
    200: {
      content: { 'application/json': { schema: userDto } },
      description: '認証済みユーザー自身の情報',
    },
    401: errorResponse('認証が必要、またはトークンが無効'),
    404: errorResponse('対象が見つからない'),
    500: errorResponse('サーバーエラー'),
  },
})

/**
 * 認証済みユーザー自身のルート（`/auth/me`）。
 */
export const meRoutes = new OpenAPIHono({ defaultHook: openApiDefaultHook }).openapi(meRoute, (c) => meController.get(c, c.get('userId')))
