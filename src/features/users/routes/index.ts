import { createRoute, OpenAPIHono } from '@hono/zod-openapi'

import { authMiddleware } from '@/middlewares/auth'
import { publicUserDto } from '@/shared/user/dtos'
import { openApiDefaultHook } from '@/utils/validation'

import { controller } from '../controllers'
import { idParamSchema } from '../schemas'
import { bearerSecurity, errorResponse } from './common'
import { meRoutes } from './me'

/** GET /users/:id: 指定したユーザーの公開情報を取得する。 */
const getByIdRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Users'],
  summary: '指定したユーザーの公開情報を取得する',
  middleware: [authMiddleware],
  security: bearerSecurity,
  request: {
    params: idParamSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: publicUserDto } },
      description: '指定ユーザーの公開情報',
    },
    400: errorResponse('ユーザーIDが不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    404: errorResponse('ユーザーが見つからない'),
    500: errorResponse('サーバーエラー'),
  },
})

/**
 * ユーザー関連のルート（/users配下）。
 * バリデーションエラー時は defaultHook で既存と同じ `{ error: { message } }`（400）を返す。
 * `/me` を `/{id}` より先に登録し、`/users/me` が `/{id}` に吸われないようにする。
 */
export const usersRoutes = new OpenAPIHono({ defaultHook: openApiDefaultHook })
  .route('/', meRoutes)
  .openapi(getByIdRoute, (c) => controller.getById(c, c.req.valid('param').id))
