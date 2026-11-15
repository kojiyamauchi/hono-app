import { OpenAPIHono } from '@hono/zod-openapi'

import { openApiDefaultHook } from '@/utils/validation'

import { loginRoutes } from './login'
import { meRoutes } from './me'
import { signupRoutes } from './signup'

/**
 * Supabase Auth 関連のルート（/supabase-auth配下）。
 * バリデーションエラー時は defaultHook で既存と同じ `{ error: { message } }`（400）を返す。
 */
export const supabaseAuthRoutes = new OpenAPIHono({ defaultHook: openApiDefaultHook }).route('/', signupRoutes).route('/', loginRoutes).route('/', meRoutes)
