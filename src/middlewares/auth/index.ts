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

  let payload
  try {
    payload = await verify(token, secret, 'HS256')
  } catch {
    throw new AppError(401, '認証トークンが無効です')
  }

  // 許容する`sub`は正の整数のみ。
  // `sub`の欠落・非数値文字列・空文字・`0`・負数・小数はすべて不正として扱い、
  // 署名検証失敗と同じ401へ畳む（`NaN`が後続クエリへ渡り500になるのを防ぐ）。
  const userId = Number(payload.sub)
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new AppError(401, '認証トークンが無効です')
  }
  c.set('userId', userId)

  await next()
})
