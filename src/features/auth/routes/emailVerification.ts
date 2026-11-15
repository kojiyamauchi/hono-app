import { createRoute, OpenAPIHono } from '@hono/zod-openapi'

import { authMiddleware } from '@/middlewares/auth'
import { originMiddleware } from '@/middlewares/origin'
import { openApiDefaultHook } from '@/utils/validation'

import { emailVerificationController } from '../controllers/emailVerification'
import { confirmBodySchema } from '../schemas/emailVerification'
import { bearerSecurity, errorResponse } from './common'

/** POST /auth/email-verification/request: 認証済みユーザーへメールアドレス検証メールを再送する。 */
const requestEmailVerificationRoute = createRoute({
  method: 'post',
  path: '/email-verification/request',
  tags: ['Auth'],
  summary: 'メールアドレス検証メールを再送する',
  middleware: [originMiddleware, authMiddleware],
  security: bearerSecurity,
  responses: {
    202: {
      description: '処理を受理',
    },
    401: errorResponse('認証が必要、またはトークンが無効'),
    403: errorResponse('許可されていないOrigin'),
    404: errorResponse('対象が見つからない'),
    409: errorResponse('メールアドレスが検証済み'),
    429: errorResponse('リクエストが多すぎる'),
    500: errorResponse('サーバーエラー'),
  },
})

/** POST /auth/email-verification/confirm: 検証トークンを使いメールアドレスを検証済みにする。 */
const confirmEmailVerificationRoute = createRoute({
  method: 'post',
  path: '/email-verification/confirm',
  tags: ['Auth'],
  summary: '検証トークンを使いメールアドレスを検証済みにする',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: confirmBodySchema } },
    },
  },
  responses: {
    204: {
      description: 'メールアドレスを検証済みに更新',
    },
    400: errorResponse('入力値が不正'),
    401: errorResponse('トークンが無効・期限切れ・使用済み'),
    500: errorResponse('サーバーエラー'),
  },
})

/**
 * メールアドレス検証のルート（`/auth/email-verification/*`）。
 * requestは認証済みの状態変更endpointとしてoriginMiddlewareを適用し、confirmは適用しない。
 */
export const emailVerificationRoutes = new OpenAPIHono({ defaultHook: openApiDefaultHook })
  .openapi(requestEmailVerificationRoute, (c) => emailVerificationController.request(c, c.get('userId')))
  .openapi(confirmEmailVerificationRoute, (c) => emailVerificationController.confirm(c, c.req.valid('json')))
