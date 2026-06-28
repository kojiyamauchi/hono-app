import { httpInstrumentationMiddleware } from '@hono/otel'
import type { Tracer } from '@opentelemetry/api'
import type { MiddlewareHandler } from 'hono'

type HttpRequestTracingOptions = {
  disableTracing?: boolean
  ignoredPaths?: string[]
  tracer?: Tracer
}

const DEFAULT_IGNORED_HTTP_TRACE_PATHS = ['/health']

/**
 * Hono requestをOpenTelemetryのHTTP server spanとして計測するmiddlewareを作成する。
 */
export const createHttpRequestTracingMiddleware = (options: HttpRequestTracingOptions = {}): MiddlewareHandler => {
  const ignoredPaths = new Set(options.ignoredPaths ?? DEFAULT_IGNORED_HTTP_TRACE_PATHS)
  const telemetryMiddleware = httpInstrumentationMiddleware({
    captureRequestHeaders: [],
    captureResponseHeaders: [],
    disableTracing: options.disableTracing,
    tracer: options.tracer,
  })
  return (c, next) => {
    if (ignoredPaths.has(c.req.path)) {
      return next()
    }

    return telemetryMiddleware(c, next)
  }
}
