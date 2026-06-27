import { SpanKind, SpanStatusCode } from '@opentelemetry/api'
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { createHttpRequestTracingMiddleware } from './hono'

const createTelemetryTestApp = (): {
  app: Hono
  exporter: InMemorySpanExporter
  provider: BasicTracerProvider
} => {
  const exporter = new InMemorySpanExporter()
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  })
  const app = new Hono()

  app.use('*', createHttpRequestTracingMiddleware({ tracer: provider.getTracer('hono-test') }))
  app.get('/users/:id', (c) => c.json({ ok: true }))
  app.get('/error', (c) => c.text('error', 500))

  return { app, exporter, provider }
}

describe('createHttpRequestTracingMiddleware', () => {
  test('requestごとにroute templateを使ったHTTP server spanを作成する', async () => {
    const { app, exporter, provider } = createTelemetryTestApp()

    const response = await app.request('/users/999')
    await provider.forceFlush()

    const [span] = exporter.getFinishedSpans()

    expect(response.status).toBe(200)
    expect(span.name).toBe('GET /users/:id')
    expect(span.kind).toBe(SpanKind.SERVER)
    expect(span.attributes['http.route']).toBe('/users/:id')
    expect(span.attributes['http.request.method']).toBe('GET')
    expect(span.attributes['http.response.status_code']).toBe(200)
  })

  test('HTTP 500 responseをerror状態としてspanへ反映する', async () => {
    const { app, exporter, provider } = createTelemetryTestApp()

    const response = await app.request('/error')
    await provider.forceFlush()

    const [span] = exporter.getFinishedSpans()

    expect(response.status).toBe(500)
    expect(span.attributes['http.response.status_code']).toBe(500)
    expect(span.status.code).toBe(SpanStatusCode.ERROR)
  })

  test('認証情報やCookieをrequest header属性へ記録しない', async () => {
    const { app, exporter, provider } = createTelemetryTestApp()

    await app.request('/users/999', {
      headers: {
        Authorization: 'Bearer secret-token',
        Cookie: 'session=secret-cookie',
      },
    })
    await provider.forceFlush()

    const [span] = exporter.getFinishedSpans()
    const attributeKeys = Object.keys(span.attributes)

    expect(attributeKeys).not.toContain('http.request.header.authorization')
    expect(attributeKeys).not.toContain('http.request.header.cookie')
    expect(Object.values(span.attributes)).not.toContain('Bearer secret-token')
    expect(Object.values(span.attributes)).not.toContain('session=secret-cookie')
  })

  test('tracing無効時もresponseを変えずspanを作成しない', async () => {
    const exporter = new InMemorySpanExporter()
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    })
    const app = new Hono()

    app.use(
      '*',
      createHttpRequestTracingMiddleware({
        disableTracing: true,
        tracer: provider.getTracer('hono-test'),
      }),
    )
    app.get('/health', (c) => c.json({ ok: true }))

    const response = await app.request('/health')
    await provider.forceFlush()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(exporter.getFinishedSpans()).toEqual([])
  })
})
