import { httpInstrumentationMiddleware } from '@hono/otel'
import type { Tracer } from '@opentelemetry/api'

type HttpRequestTracingOptions = {
  disableTracing?: boolean
  tracer?: Tracer
}

/**
 * Hono requestをOpenTelemetryのHTTP server spanとして計測するmiddlewareを作成する。
 */
export const createHttpRequestTracingMiddleware = (options: HttpRequestTracingOptions = {}): ReturnType<typeof httpInstrumentationMiddleware> =>
  httpInstrumentationMiddleware({
    captureRequestHeaders: [],
    captureResponseHeaders: [],
    disableTracing: options.disableTracing,
    tracer: options.tracer,
  })
