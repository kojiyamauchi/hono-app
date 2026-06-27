import { Hono } from 'hono'
import { cors } from 'hono/cors'

import { createHttpRequestTracingMiddleware } from '@/libs/telemetry/hono'
import { getAllowedOrigins } from '@/middlewares/origin'

import { registerRoutes } from './routes'

export const app = new Hono()

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
