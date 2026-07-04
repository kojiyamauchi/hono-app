import { createMiddleware } from 'hono/factory'
import { verify } from 'hono/jwt'

import { authSubjectSchema } from '@/shared/auth/schemas'
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

  // 許容する`sub`は正の整数のみ（詳細な許容範囲はauthSubjectSchemaに集約）。
  // 欠落・非数値・空文字・`0`・負数・小数に加え、boolean・配列・指数/小数/16進表記の
  // 文字列もすべて不正として扱い、署名検証失敗と同じ401へ畳む
  // （`NaN`や想定外の値が後続のPrismaクエリへ渡り500になるのを防ぐ）。
  const parsedSubject = authSubjectSchema.safeParse(payload.sub)
  if (!parsedSubject.success) {
    throw new AppError(401, '認証トークンが無効です')
  }
  c.set('userId', parsedSubject.data)

  await next()
})
