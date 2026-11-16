import { createRoute, OpenAPIHono } from '@hono/zod-openapi'

import { openApiDefaultHook } from '@/utils/validation'

import { declineController } from '../controllers/decline'
import { bodySchema } from '../schemas/decline'
import { errorResponse } from './common'

/** POST /invitations/decline: 招待を辞退する（認証不要・トークンのみで操作）。 */
const executeRoute = createRoute({
  method: 'post',
  path: '/decline',
  tags: ['Invitations'],
  summary: '招待トークンを指定して招待を辞退する',
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
      description: '招待を辞退（無内容）',
    },
    400: errorResponse('入力値が不正'),
    404: errorResponse('招待が見つからない'),
    409: errorResponse('招待が辞退不可（不正ステータス・期限切れ・競合）'),
    500: errorResponse('サーバーエラー'),
  },
})

/** 招待辞退のルート（/invitations/decline）。認証不要。 */
export const declineRoutes = new OpenAPIHono({ defaultHook: openApiDefaultHook }).openapi(executeRoute, (c) =>
  declineController.execute(c, c.req.valid('json')),
)
