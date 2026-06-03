import { createMiddleware } from 'hono/factory'
import { verify } from 'hono/jwt'

import { AppError } from '@/utils/errors'

/**
 * JWT検証ミドルウェア。
 * `Authorization: Bearer <token>` を検証し、ユーザーIDを `userId` としてcontextに格納する。
 */
export const authMiddleware = createMiddleware<{
  Variables: { userId: number }
}>(async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError(401, '認証トークンが必要です')
  }

  const token = authHeader.slice('Bearer '.length)
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new AppError(500, 'JWT_SECRETが設定されていません')
  }

  try {
    const payload = await verify(token, secret, 'HS256')
    c.set('userId', Number(payload.sub))
  } catch {
    throw new AppError(401, '認証トークンが無効です')
  }

  await next()
})
