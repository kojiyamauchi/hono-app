import { createRoute, OpenAPIHono } from '@hono/zod-openapi'

import { authMiddleware } from '@/middlewares/auth'
import { userDto } from '@/shared/user/dtos'
import { openApiDefaultHook } from '@/utils/validation'

import { meController } from '../controllers/me'
import { removeBodySchema, updateBodySchema } from '../schemas/me'
import { bearerSecurity, errorResponse } from './common'

/** GET /users/me: 認証済みユーザー自身の詳細情報を返す。 */
const getRoute = createRoute({
  method: 'get',
  path: '/me',
  tags: ['Users'],
  summary: '認証済みユーザー自身の情報を取得する',
  middleware: [authMiddleware],
  security: bearerSecurity,
  responses: {
    200: {
      content: { 'application/json': { schema: userDto } },
      description: '認証済みユーザー自身の情報',
    },
    401: errorResponse('認証が必要、またはトークンが無効'),
    404: errorResponse('ユーザーが見つからない'),
    500: errorResponse('サーバーエラー'),
  },
})

/** PATCH /users/me: 認証済みユーザー自身の情報を更新する。 */
const updateRoute = createRoute({
  method: 'patch',
  path: '/me',
  tags: ['Users'],
  summary: '認証済みユーザー自身の情報を更新する',
  middleware: [authMiddleware],
  security: bearerSecurity,
  request: {
    body: {
      // required: true を付けないと、Content-Typeなし/bodyなしのPATCHが任意bodyとして
      // 検証スキップされ c.req.valid('json') が {} になり200が返る。既存の必須body検証（400）を維持する。
      required: true,
      content: { 'application/json': { schema: updateBodySchema } },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: userDto } },
      description: '更新後のユーザー情報',
    },
    400: errorResponse('入力値が不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    404: errorResponse('ユーザーが見つからない'),
    500: errorResponse('サーバーエラー'),
  },
})

/** DELETE /users/me: 現在のパスワードで本人確認し、認証済みユーザー自身のアカウントを削除する。 */
const removeRoute = createRoute({
  method: 'delete',
  path: '/me',
  tags: ['Users'],
  summary: '認証済みユーザー自身のアカウントを削除する',
  middleware: [authMiddleware],
  security: bearerSecurity,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: removeBodySchema } },
    },
  },
  responses: {
    204: {
      description: 'アカウントを削除',
    },
    400: errorResponse('入力値が不正'),
    401: errorResponse('認証が必要、またはトークンが無効、または現在のパスワードが正しくない'),
    404: errorResponse('ユーザーが見つからない'),
    409: errorResponse('唯一のOWNERである組織が存在するため削除できない'),
    500: errorResponse('サーバーエラー'),
  },
})

/**
 * 認証済みユーザー自身のルート（`/users/me`）。
 */
export const meRoutes = new OpenAPIHono({ defaultHook: openApiDefaultHook })
  .openapi(getRoute, (c) => meController.get(c, c.get('userId')))
  .openapi(updateRoute, (c) => meController.update(c, c.get('userId'), c.req.valid('json')))
  .openapi(removeRoute, (c) => meController.remove(c, c.get('userId'), c.req.valid('json')))
