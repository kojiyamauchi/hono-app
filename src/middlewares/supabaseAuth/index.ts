import type { User } from '@supabase/supabase-js'
import { createMiddleware } from 'hono/factory'

import { supabase } from '@/libs/supabase'
import { AppError } from '@/utils/errors'

/**
 * Supabase Auth のJWT検証ミドルウェア。
 * `Authorization: Bearer <token>` を `supabase.auth.getUser` で検証し、
 * 取得したユーザーを `supabaseUser` としてcontextに格納する。
 */
export const supabaseAuthMiddleware = createMiddleware<{
  Variables: { supabaseUser: User }
}>(async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AppError(401, '認証トークンが必要です')
  }

  const token = authHeader.slice('Bearer '.length)
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) {
    throw new AppError(401, '認証トークンが無効です')
  }

  c.set('supabaseUser', data.user)
  await next()
})
