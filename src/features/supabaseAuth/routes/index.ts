import { createRoute, OpenAPIHono } from '@hono/zod-openapi'

import { supabaseAuthMiddleware } from '@/middlewares/supabaseAuth'
import { errorResponseDto } from '@/shared/openApi/dtos'
import { SECURITY_SCHEME } from '@/shared/openApi/schemes'
import { openApiDefaultHook } from '@/utils/validation'

import { supabaseAuthController } from '../controllers'
import { authResultDto, supabaseUserDto } from '../dtos'
import { loginSchema, signupSchema } from '../schemas'

/** JSONエラーレスポンス（`{ error: { message } }`）の共通定義を生成する。 */
const errorResponse = (description: string): { content: { 'application/json': { schema: typeof errorResponseDto } }; description: string } => ({
  content: { 'application/json': { schema: errorResponseDto } },
  description,
})

/** /me が要求するsecurity（Bearerアクセストークン）。 */
const bearerSecurity = [{ [SECURITY_SCHEME.bearer]: [] }]

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
      content: { 'application/json': { schema: signupSchema } },
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

/** POST /supabase-auth/login: メールアドレスとパスワードでログインする。 */
const loginRoute = createRoute({
  method: 'post',
  path: '/login',
  tags: ['Supabase Auth'],
  summary: 'メールアドレスとパスワードでログインする',
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
    500: errorResponse('サーバーエラー'),
  },
})

/** GET /supabase-auth/me: 認証済みユーザー自身の情報を返す。 */
const meRoute = createRoute({
  method: 'get',
  path: '/me',
  tags: ['Supabase Auth'],
  summary: '認証済みユーザー自身の情報を取得する',
  middleware: [supabaseAuthMiddleware],
  security: bearerSecurity,
  responses: {
    200: {
      content: { 'application/json': { schema: supabaseUserDto } },
      description: '認証済みユーザー情報',
    },
    401: errorResponse('認証が必要、またはトークンが無効'),
    500: errorResponse('サーバーエラー'),
  },
})

/**
 * Supabase Auth 関連のルート（/supabase-auth配下）。
 * バリデーションエラー時は defaultHook で既存と同じ `{ error: { message } }`（400）を返す。
 */
export const supabaseAuthRoutes = new OpenAPIHono({ defaultHook: openApiDefaultHook })
  .openapi(signupRoute, (c) => supabaseAuthController.signup(c, c.req.valid('json')))
  .openapi(loginRoute, (c) => supabaseAuthController.login(c, c.req.valid('json')))
  .openapi(meRoute, (c) => supabaseAuthController.me(c, c.get('supabaseUser')))
