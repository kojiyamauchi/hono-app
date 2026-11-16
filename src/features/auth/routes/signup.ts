import { createRoute, OpenAPIHono } from '@hono/zod-openapi'

import { originMiddleware } from '@/middlewares/origin'
import { authResultDto } from '@/shared/auth/dtos'
import { openApiDefaultHook } from '@/utils/validation'

import { signupController } from '../controllers/signup'
import { bodySchema } from '../schemas/signup'
import { errorResponse } from './common'

/** POST /auth/signup: 新規ユーザーを登録し、認証結果を返す。 */
const signupRoute = createRoute({
  method: 'post',
  path: '/signup',
  tags: ['Auth'],
  summary: 'ユーザーを登録する',
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
    201: {
      content: { 'application/json': { schema: authResultDto } },
      description: '登録結果',
    },
    400: errorResponse('入力値が不正'),
    403: errorResponse('許可されていないOrigin'),
    409: errorResponse('メールアドレスが既に登録済み'),
    429: errorResponse('リクエストが多すぎる'),
    500: errorResponse('サーバーエラー'),
  },
})

/**
 * サインアップのルート（`/auth/signup`）。
 */
export const signupRoutes = new OpenAPIHono({ defaultHook: openApiDefaultHook }).openapi(signupRoute, (c) => signupController.execute(c, c.req.valid('json')))
