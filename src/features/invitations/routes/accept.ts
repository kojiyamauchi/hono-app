import { createRoute, OpenAPIHono } from '@hono/zod-openapi'

import { authMiddleware } from '@/middlewares/auth'
import { memberDto } from '@/shared/membership/dtos'
import { openApiDefaultHook } from '@/utils/validation'

import { acceptController } from '../controllers/accept'
import { bodySchema } from '../schemas/accept'
import { bearerSecurity, errorResponse } from './common'

/** POST /invitations/accept: 招待を受諾して組織メンバーになる（認証必要）。 */
const executeRoute = createRoute({
  method: 'post',
  path: '/accept',
  tags: ['Invitations'],
  summary: '招待トークンを指定して招待を受諾し、組織メンバーになる',
  middleware: [authMiddleware],
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
    201: {
      content: { 'application/json': { schema: memberDto } },
      description: '作成されたmembership',
    },
    400: errorResponse('入力値が不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    403: errorResponse('招待のメールアドレスと認証ユーザーが一致しない'),
    404: errorResponse('招待またはユーザーが見つからない'),
    409: errorResponse('招待が受諾不可（不正ステータス・期限切れ・既にメンバー）'),
    500: errorResponse('サーバーエラー'),
  },
})

/** 招待受諾のルート（/invitations/accept）。認証が必要。 */
export const acceptRoutes = new OpenAPIHono({ defaultHook: openApiDefaultHook }).openapi(executeRoute, (c) =>
  acceptController.execute(c, c.get('userId'), c.req.valid('json')),
)
