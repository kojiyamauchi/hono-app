import type { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import { authRoutes } from '@/features/auth/routes'
import { AppError } from '@/utils/errors'

export const registerRoutes = (app: Hono): void => {
  app.get('/', (c) => {
    return c.text('Hello Hono Dev Watch')
  })

  app.get('/health', (c) => {
    return c.json({ ok: true })
  })

  // 認証関連ルート（/auth配下）をマウントする
  app.route('/auth', authRoutes)

  // 共通エラーハンドラ。AppErrorはそのstatusCodeで、想定外のエラーは500で統一形式を返す
  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { message: err.message } }, err.statusCode as ContentfulStatusCode)
    }

    console.error(err)
    return c.json({ error: { message: 'サーバーエラーが発生しました' } }, 500)
  })
}
