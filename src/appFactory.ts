import { OpenAPIHono } from '@hono/zod-openapi'
import { cors } from 'hono/cors'

import { createHttpRequestTracingMiddleware } from '@/libs/telemetry/hono'
import { getAllowedOrigins } from '@/middlewares/origin'
import { getInvitationEmailConfig } from '@/shared/invitation/services/emailConfig'

import { registerRoutes } from './routes'

/** 実行環境のスコープ内でCORS・設定検証・公開ルートを組み立てる。 */
export const createApp = (options: { disableTracing?: boolean } = {}): OpenAPIHono => {
  getInvitationEmailConfig()

  // OpenAPI仕様を全featureのroute定義から集約するため、root appはOpenAPIHonoにする。
  const app = new OpenAPIHono()

  app.use('*', createHttpRequestTracingMiddleware({ disableTracing: options.disableTracing }))

  // 資格情報付きCORSをappレベルで設定する。
  // originはALLOWED_ORIGINSで管理し、ワイルドカードを使わない。
  app.use(
    cors({
      origin: getAllowedOrigins(),
      credentials: true,
    }),
  )

  registerRoutes(app)
  return app
}
