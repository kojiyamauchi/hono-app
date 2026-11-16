import { createRoute, OpenAPIHono } from '@hono/zod-openapi'

import { originMiddleware } from '@/middlewares/origin'
import { authResultDto } from '@/shared/auth/dtos'
import { openApiDefaultHook } from '@/utils/validation'

import { loginController } from '../controllers/login'
import { bodySchema } from '../schemas/login'
import { errorResponse } from './common'

/** POST /auth/login: メールアドレスとパスワードでログインする。 */
const loginRoute = createRoute({
  method: 'post',
  path: '/login',
  tags: ['Auth'],
  summary: 'メールアドレスとパスワードでログインする',
  middleware: [originMiddleware],
  request: {
    body: {
      // required: true を付けないと、Content-Typeなし/bodyなしのPOSTが任意bodyとして
      // 検証スキップされ c.req.valid('json') が {} になり400が返らなくなる。既存の必須body検証を維持する。
      required: true,
      content: { 'application/json': { schema: bodySchema } },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: authResultDto } },
      description: 'ログイン結果',
    },
    400: errorResponse('入力値が不正'),
    401: errorResponse('メールアドレスまたはパスワードが正しくない'),
    403: errorResponse('許可されていないOrigin'),
    429: errorResponse('リクエストが多すぎる'),
    500: errorResponse('サーバーエラー'),
  },
})

/**
 * ログインのルート（`/auth/login`）。
 */
export const loginRoutes = new OpenAPIHono({ defaultHook: openApiDefaultHook }).openapi(loginRoute, (c) => loginController.execute(c, c.req.valid('json')))
