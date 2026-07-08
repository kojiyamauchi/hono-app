import { createRoute, OpenAPIHono } from '@hono/zod-openapi'

import { authMiddleware } from '@/middlewares/auth'
import { originMiddleware } from '@/middlewares/origin'
import { authResultDto } from '@/shared/auth/dtos'
import { errorResponseDto } from '@/shared/openApi/dtos'
import { SECURITY_SCHEME } from '@/shared/openApi/schemes'
import { userDto } from '@/shared/user/dtos'
import { openApiDefaultHook } from '@/utils/validation'

import { authController } from '../controllers'
import { sessionListDto } from '../dtos'
import { changePasswordSchema, confirmPasswordResetSchema, deleteSessionParamSchema, loginSchema, requestPasswordResetSchema, signupSchema } from '../schemas'

/** JSONエラーレスポンス（`{ error: { message } }`）の共通定義を生成する。 */
const errorResponse = (description: string): { content: { 'application/json': { schema: typeof errorResponseDto } }; description: string } => ({
  content: { 'application/json': { schema: errorResponseDto } },
  description,
})

/** アクセストークン（Authorization: Bearer）を要求するendpoint用のsecurity。 */
const bearerSecurity = [{ [SECURITY_SCHEME.bearer]: [] }]

/** リフレッシュトークンCookieを要求するendpoint用のsecurity。 */
const cookieSecurity = [{ [SECURITY_SCHEME.cookie]: [] }]

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
      content: { 'application/json': { schema: signupSchema } },
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

/** POST /auth/login: メールアドレスとパスワードでログインする。 */
const loginRoute = createRoute({
  method: 'post',
  path: '/login',
  tags: ['Auth'],
  summary: 'メールアドレスとパスワードでログインする',
  middleware: [originMiddleware],
  request: {
    body: {
      // required: true を付けないと、Content-Typeなし/bodyなしのPOSTが任意bodyとして
      // 検証スキップされ c.req.valid('json') が {} になり400が返らなくなる。既存の必須body検証を維持する。
      required: true,
      content: { 'application/json': { schema: loginSchema } },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: authResultDto } },
      description: 'ログイン結果',
    },
    400: errorResponse('入力値が不正'),
    401: errorResponse('メールアドレスまたはパスワードが正しくない'),
    403: errorResponse('許可されていないOrigin'),
    429: errorResponse('リクエストが多すぎる'),
    500: errorResponse('サーバーエラー'),
  },
})

/** POST /auth/refresh: Cookieのリフレッシュトークンをローテーションしてアクセストークンを再発行する。 */
const refreshRoute = createRoute({
  method: 'post',
  path: '/refresh',
  tags: ['Auth'],
  summary: 'リフレッシュトークンをローテーションしてアクセストークンを再発行する',
  middleware: [originMiddleware],
  security: cookieSecurity,
  responses: {
    200: {
      content: { 'application/json': { schema: authResultDto } },
      description: 'ローテーション結果',
    },
    401: errorResponse('リフレッシュトークンが無効'),
    403: errorResponse('許可されていないOrigin'),
    500: errorResponse('サーバーエラー'),
  },
})

/** POST /auth/logout: Cookieのリフレッシュトークンに対応するログインセッションを失効する。 */
const logoutRoute = createRoute({
  method: 'post',
  path: '/logout',
  tags: ['Auth'],
  summary: 'リフレッシュトークンに対応するログインセッションを失効する',
  middleware: [originMiddleware],
  security: cookieSecurity,
  responses: {
    204: {
      description: '処理を受理',
    },
    403: errorResponse('許可されていないOrigin'),
    500: errorResponse('サーバーエラー'),
  },
})

/** GET /auth/me: 認証済みユーザー自身の情報を返す。 */
const meRoute = createRoute({
  method: 'get',
  path: '/me',
  tags: ['Auth'],
  summary: '認証トークンに紐づくユーザー情報を取得する',
  middleware: [authMiddleware],
  security: bearerSecurity,
  responses: {
    200: {
      content: { 'application/json': { schema: userDto } },
      description: '認証済みユーザー自身の情報',
    },
    401: errorResponse('認証が必要、またはトークンが無効'),
    404: errorResponse('対象が見つからない'),
    500: errorResponse('サーバーエラー'),
  },
})

/** POST /auth/change-password: 現在のパスワードを検証して新しいパスワードへ変更し、全リフレッシュセッションを失効する。 */
const changePasswordRoute = createRoute({
  method: 'post',
  path: '/change-password',
  tags: ['Auth'],
  summary: '現在のパスワードを検証して新しいパスワードへ変更する',
  middleware: [originMiddleware, authMiddleware],
  security: bearerSecurity,
  request: {
    body: {
      // required: true を付けないと、Content-Typeなし/bodyなしのPOSTが任意bodyとして
      // 検証スキップされ c.req.valid('json') が {} になり400が返らなくなる。既存の必須body検証を維持する。
      required: true,
      content: { 'application/json': { schema: changePasswordSchema } },
    },
  },
  responses: {
    204: {
      description: '処理を受理',
    },
    400: errorResponse('入力値が不正'),
    401: errorResponse('認証が必要、またはトークンが無効、または現在のパスワードが正しくない'),
    403: errorResponse('許可されていないOrigin'),
    404: errorResponse('対象が見つからない'),
    500: errorResponse('サーバーエラー'),
  },
})

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
      content: { 'application/json': { schema: requestPasswordResetSchema } },
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
      content: { 'application/json': { schema: confirmPasswordResetSchema } },
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

/** POST /auth/logout-all: 認証済みユーザーの全リフレッシュセッションを失効する。 */
const logoutAllRoute = createRoute({
  method: 'post',
  path: '/logout-all',
  tags: ['Auth'],
  summary: '認証済みユーザーの全リフレッシュセッションを失効する',
  middleware: [originMiddleware, authMiddleware],
  security: bearerSecurity,
  responses: {
    204: {
      description: '処理を受理',
    },
    401: errorResponse('認証が必要、またはトークンが無効'),
    403: errorResponse('許可されていないOrigin'),
    500: errorResponse('サーバーエラー'),
  },
})

/** GET /auth/sessions: 認証済みユーザーのリフレッシュセッション一覧を取得する。 */
const listSessionsRoute = createRoute({
  method: 'get',
  path: '/sessions',
  tags: ['Auth'],
  summary: '認証済みユーザーのリフレッシュセッション一覧を取得する',
  middleware: [authMiddleware],
  security: bearerSecurity,
  responses: {
    200: {
      content: { 'application/json': { schema: sessionListDto } },
      description: 'activeなリフレッシュセッション一覧',
    },
    401: errorResponse('認証が必要、またはトークンが無効'),
    500: errorResponse('サーバーエラー'),
  },
})

/** DELETE /auth/sessions/{id}: 認証済みユーザー自身の指定リフレッシュセッションを失効する。 */
const logoutSessionRoute = createRoute({
  method: 'delete',
  path: '/sessions/{id}',
  tags: ['Auth'],
  summary: '認証済みユーザー自身の指定リフレッシュセッションを失効する',
  middleware: [originMiddleware, authMiddleware],
  security: bearerSecurity,
  request: {
    params: deleteSessionParamSchema,
  },
  responses: {
    204: {
      description: '処理を受理',
    },
    400: errorResponse('セッションIDの形式が不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    403: errorResponse('許可されていないOrigin'),
    404: errorResponse('対象が見つからない'),
    500: errorResponse('サーバーエラー'),
  },
})

/**
 * 認証関連のルート（/auth配下）。
 * signup/login/refresh/logoutにはCookieを利用・更新するためOrigin検証を適用する。
 * password-reset/*はCookie/ambient credentialを使用しないためoriginMiddlewareは適用しない。
 * バリデーションエラー時は defaultHook で既存と同じ `{ error: { message } }`（400）を返す。
 * `/sessions` を `/sessions/{id}` より先に登録し、静的パスを優先する。
 */
export const authRoutes = new OpenAPIHono({ defaultHook: openApiDefaultHook })
  .openapi(signupRoute, (c) => authController.signup(c, c.req.valid('json')))
  .openapi(loginRoute, (c) => authController.login(c, c.req.valid('json')))
  .openapi(refreshRoute, (c) => authController.refresh(c))
  .openapi(logoutRoute, (c) => authController.logout(c))
  .openapi(meRoute, (c) => authController.me(c, c.get('userId')))
  .openapi(changePasswordRoute, (c) => authController.changePassword(c, c.get('userId'), c.req.valid('json')))
  .openapi(requestPasswordResetRoute, (c) => authController.requestPasswordReset(c, c.req.valid('json')))
  .openapi(confirmPasswordResetRoute, (c) => authController.confirmPasswordReset(c, c.req.valid('json')))
  .openapi(logoutAllRoute, (c) => authController.logoutAll(c, c.get('userId')))
  .openapi(listSessionsRoute, (c) => authController.listSessions(c, c.get('userId')))
  .openapi(logoutSessionRoute, (c) => authController.logoutSession(c, c.get('userId'), c.req.valid('param')))
