import { createRoute, OpenAPIHono } from '@hono/zod-openapi'

import { openApiDefaultHook } from '@/utils/validation'

import { signupController } from '../controllers/signup'
import { authResultDto } from '../dtos'
import { bodySchema } from '../schemas/signup'
import { errorResponse } from './common'

/** POST /supabase-auth/signup: 新規ユーザーを登録し、認証結果を返す。 */
const signupRoute = createRoute({
  method: 'post',
  path: '/signup',
  tags: ['Supabase Auth'],
  summary: '新規ユーザーを登録する',
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
    400: errorResponse('入力値が不正、または登録に失敗'),
    500: errorResponse('サーバーエラー'),
  },
})

/**
 * サインアップのルート（`/supabase-auth/signup`）。
 */
export const signupRoutes = new OpenAPIHono({ defaultHook: openApiDefaultHook }).openapi(signupRoute, (c) => signupController.execute(c, c.req.valid('json')))
