import { createRoute, OpenAPIHono } from '@hono/zod-openapi'

import { authMiddleware } from '@/middlewares/auth'
import { originMiddleware } from '@/middlewares/origin'
import { openApiDefaultHook } from '@/utils/validation'

import { changePasswordController } from '../controllers/changePassword'
import { bodySchema } from '../schemas/changePassword'
import { bearerSecurity, errorResponse } from './common'

/** POST /auth/change-password: 現在のパスワードを検証して新しいパスワードへ変更し、全リフレッシュセッションを失効する。 */
const changePasswordRoute = createRoute({
  method: 'post',
  path: '/change-password',
  tags: ['Auth'],
  summary: '現在のパスワードを検証して新しいパスワードへ変更する',
  middleware: [originMiddleware, authMiddleware],
  security: bearerSecurity,
  request: {
    body: {
      // required: true を付けないと、Content-Typeなし/bodyなしのPOSTが任意bodyとして
      // 検証スキップされ c.req.valid('json') が {} になり400が返らなくなる。既存の必須body検証を維持する。
      required: true,
      content: { 'application/json': { schema: bodySchema } },
    },
  },
  responses: {
    204: {
      description: '処理を受理',
    },
    400: errorResponse('入力値が不正'),
    401: errorResponse('認証が必要、またはトークンが無効、または現在のパスワードが正しくない'),
    403: errorResponse('許可されていないOrigin'),
    404: errorResponse('対象が見つからない'),
    500: errorResponse('サーバーエラー'),
  },
})

/**
 * パスワード変更のルート（`/auth/change-password`）。
 */
export const changePasswordRoutes = new OpenAPIHono({ defaultHook: openApiDefaultHook }).openapi(changePasswordRoute, (c) =>
  changePasswordController.execute(c, c.get('userId'), c.req.valid('json')),
)
