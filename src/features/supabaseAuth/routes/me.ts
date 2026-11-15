import { createRoute, OpenAPIHono } from '@hono/zod-openapi'

import { supabaseAuthMiddleware } from '@/middlewares/supabaseAuth'
import { openApiDefaultHook } from '@/utils/validation'

import { meController } from '../controllers/me'
import { supabaseUserDto } from '../dtos'
import { bearerSecurity, errorResponse } from './common'

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
 * 認証済みユーザー自身のルート（`/supabase-auth/me`）。
 */
export const meRoutes = new OpenAPIHono({ defaultHook: openApiDefaultHook }).openapi(meRoute, (c) => meController.get(c, c.get('supabaseUser')))
