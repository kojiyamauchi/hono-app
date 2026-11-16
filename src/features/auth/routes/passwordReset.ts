import { createRoute, OpenAPIHono } from '@hono/zod-openapi'

import { openApiDefaultHook } from '@/utils/validation'

import { passwordResetController } from '../controllers/passwordReset'
import { confirmBodySchema, requestBodySchema } from '../schemas/passwordReset'
import { errorResponse } from './common'

/** POST /auth/password-reset/request: パスワードリセット用トークンを発行し通知する。 */
const requestPasswordResetRoute = createRoute({
  method: 'post',
  path: '/password-reset/request',
  tags: ['Auth'],
  summary: 'パスワードリセット用トークンを発行し通知する',
  request: {
    body: {
      // required: true を付けないと、Content-Typeなし/bodyなしのPOSTが任意bodyとして
      // 検証スキップされ c.req.valid('json') が {} になり400が返らなくなる。既存の必須body検証を維持する。
      required: true,
      content: { 'application/json': { schema: requestBodySchema } },
    },
  },
  responses: {
    202: {
      description: '処理を受理（登録有無・通知成否にかかわらず202）',
    },
    400: errorResponse('入力値が不正'),
    429: errorResponse('リクエストが多すぎる'),
    500: errorResponse('サーバーエラー'),
  },
})

/** POST /auth/password-reset/confirm: リセットトークンを使い新しいパスワードを設定する。 */
const confirmPasswordResetRoute = createRoute({
  method: 'post',
  path: '/password-reset/confirm',
  tags: ['Auth'],
  summary: 'リセットトークンを使い新しいパスワードを設定する',
  request: {
    body: {
      // required: true を付けないと、Content-Typeなし/bodyなしのPOSTが任意bodyとして
      // 検証スキップされ c.req.valid('json') が {} になり400が返らなくなる。既存の必須body検証を維持する。
      required: true,
      content: { 'application/json': { schema: confirmBodySchema } },
    },
  },
  responses: {
    204: {
      description: '処理を受理',
    },
    400: errorResponse('入力値が不正'),
    401: errorResponse('トークンが無効・期限切れ・使用済み'),
    500: errorResponse('サーバーエラー'),
  },
})

/**
 * パスワードリセットのルート（`/auth/password-reset/*`）。
 * Cookie/ambient credentialを使用しないためoriginMiddlewareは適用しない。
 */
export const passwordResetRoutes = new OpenAPIHono({ defaultHook: openApiDefaultHook })
  .openapi(requestPasswordResetRoute, (c) => passwordResetController.request(c, c.req.valid('json')))
  .openapi(confirmPasswordResetRoute, (c) => passwordResetController.confirm(c, c.req.valid('json')))
