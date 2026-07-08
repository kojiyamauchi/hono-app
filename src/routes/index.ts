import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import { authRoutes } from '@/features/auth/routes'
import { invitationsRoutes } from '@/features/invitations/routes'
import { registerOpenApiRoutes } from '@/features/openApi/routes'
import { organizationsRoutes } from '@/features/organizations/routes'
import { supabaseAuthRoutes } from '@/features/supabaseAuth/routes'
import { usersRoutes } from '@/features/users/routes'
import { AppError } from '@/utils/errors'

/** GET /: 動作確認用のテキストを返す。 */
const rootRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Common'],
  summary: '動作確認用のテキストを返す',
  responses: {
    200: {
      content: { 'text/plain': { schema: z.string() } },
      description: '動作確認用テキスト',
    },
  },
})

/** GET /health: ヘルスチェック結果を返す。 */
const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['Common'],
  summary: 'ヘルスチェック結果を返す',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({ ok: z.boolean() }).openapi('HealthResponse'),
        },
      },
      description: 'ヘルスチェック結果',
    },
  },
})

export const registerRoutes = (app: OpenAPIHono): void => {
  app.openapi(rootRoute, (c) => {
    return c.text('Hello Hono Dev Watch', 200)
  })

  app.openapi(healthRoute, (c) => {
    return c.json({ ok: true }, 200)
  })

  // 認証関連ルート（/auth配下）をマウントする
  app.route('/auth', authRoutes)

  // Supabase Auth 関連ルート（/supabase-auth配下）をマウントする
  app.route('/supabase-auth', supabaseAuthRoutes)

  // ユーザー関連ルート（/users配下）をマウントする
  app.route('/users', usersRoutes)

  // 組織関連ルート（/organizations配下）をマウントする
  app.route('/organizations', organizationsRoutes)

  // 招待受諾ルート（/invitations配下）をマウントする
  app.route('/invitations', invitationsRoutes)

  // 共通エラーハンドラ。AppErrorはそのstatusCodeで、想定外のエラーは500で統一形式を返す
  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { message: err.message } }, err.statusCode as ContentfulStatusCode)
    }

    console.error(err)
    return c.json({ error: { message: 'サーバーエラーが発生しました' } }, 500)
  })

  /*
   * /open-api（OpenAPI JSON / Scalar UI）は例外的に app.route() での mount ではなく、
   * features/openApi の登録関数へ root app を渡して登録する。
   * OpenAPI仕様は全featureの定義が root app の registry へ集約される必要があり、doc生成が
   * root app の責務になるため（詳細は features/openApi/routes/index.ts のコメント参照）。
   * 全 app.route(...) の後に呼び、registryが出揃った状態で /open-api/doc を生成する。
   */
  registerOpenApiRoutes(app)
}
