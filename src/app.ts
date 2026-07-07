import { OpenAPIHono } from '@hono/zod-openapi'
import { cors } from 'hono/cors'

import { createHttpRequestTracingMiddleware } from '@/libs/telemetry/hono'
import { getAllowedOrigins } from '@/middlewares/origin'

import { registerRoutes } from './routes'

// OpenAPI仕様を全featureのroute定義から集約するため、root appはOpenAPIHonoにする。
export const app = new OpenAPIHono()

app.use('*', createHttpRequestTracingMiddleware())

// 資格情報付きCORSをappレベルで設定する。
// originはALLOWED_ORIGINSで管理し、ワイルドカードを使わない。
app.use(
  cors({
    origin: getAllowedOrigins(),
    credentials: true,
  }),
)

registerRoutes(app)
