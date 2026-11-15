import { createRoute, OpenAPIHono } from '@hono/zod-openapi'

import { originMiddleware } from '@/middlewares/origin'
import { authResultDto } from '@/shared/auth/dtos'
import { openApiDefaultHook } from '@/utils/validation'

import { signupController } from '../controllers/signup'
import { bodySchema } from '../schemas/signup'
import { errorResponse } from './common'

/** POST /invitations/signup: 招待経由で新規登録して組織メンバーになる（認証不要・Cookie設定のためOrigin検証）。 */
const executeRoute = createRoute({
  method: 'post',
  path: '/signup',
  tags: ['Invitations'],
  summary: '招待トークンを指定して新規登録し、組織メンバーになる',
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
      description: '登録結果（アクセストークンとユーザー情報・リフレッシュトークンはCookie）',
    },
    400: errorResponse('入力値が不正'),
    403: errorResponse('許可されていないOrigin'),
    404: errorResponse('招待が見つからない'),
    409: errorResponse('招待経由の登録不可（不正ステータス・期限切れ・メール重複・競合）'),
    500: errorResponse('サーバーエラー'),
  },
})

/** 招待経由サインアップのルート（/invitations/signup）。Cookieを設定するためOrigin検証を適用する。 */
export const signupRoutes = new OpenAPIHono({ defaultHook: openApiDefaultHook }).openapi(executeRoute, (c) => signupController.execute(c, c.req.valid('json')))
