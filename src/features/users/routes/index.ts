import { createRoute, OpenAPIHono } from '@hono/zod-openapi'

import { authMiddleware } from '@/middlewares/auth'
import { errorResponseDto } from '@/shared/openApi/dtos'
import { SECURITY_SCHEME } from '@/shared/openApi/schemes'
import { publicUserDto, userDto } from '@/shared/user/dtos'
import { openApiDefaultHook } from '@/utils/validation'

import { usersController } from '../controllers'
import { deleteMeSchema, updateMeSchema, userIdParamSchema } from '../schemas'

/** JSONエラーレスポンス（`{ error: { message } }`）の共通定義を生成する。 */
const errorResponse = (description: string): { content: { 'application/json': { schema: typeof errorResponseDto } }; description: string } => ({
  content: { 'application/json': { schema: errorResponseDto } },
  description,
})

/** users featureの全ルートに共通するsecurity（Bearerアクセストークン）。 */
const bearerSecurity = [{ [SECURITY_SCHEME.bearer]: [] }]

/** GET /users/me: 認証済みユーザー自身の詳細情報を返す。 */
const meRoute = createRoute({
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
const updateMeRoute = createRoute({
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
      content: { 'application/json': { schema: updateMeSchema } },
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
const deleteMeRoute = createRoute({
  method: 'delete',
  path: '/me',
  tags: ['Users'],
  summary: '認証済みユーザー自身のアカウントを削除する',
  middleware: [authMiddleware],
  security: bearerSecurity,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: deleteMeSchema } },
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

/** GET /users/:id: 指定したユーザーの公開情報を取得する。 */
const getByIdRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Users'],
  summary: '指定したユーザーの公開情報を取得する',
  middleware: [authMiddleware],
  security: bearerSecurity,
  request: {
    params: userIdParamSchema,
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
  .openapi(meRoute, (c) => usersController.me(c, c.get('userId')))
  .openapi(updateMeRoute, (c) => usersController.updateMe(c, c.get('userId'), c.req.valid('json')))
  .openapi(deleteMeRoute, (c) => usersController.deleteMe(c, c.get('userId'), c.req.valid('json')))
  .openapi(getByIdRoute, (c) => usersController.getById(c, c.req.valid('param').id))
