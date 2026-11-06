import { SpanStatusCode } from '@opentelemetry/api'
import { BasicTracerProvider, InMemorySpanExporter } from '@opentelemetry/sdk-trace-base'
import { expect, test } from 'bun:test'

import { RedactingSpanProcessor } from './spanProcessor'

test('外部送信するspanから機微な値を除き、処理の識別情報と結果を残す', async () => {
  const exporter = new InMemorySpanExporter()
  const provider = new BasicTracerProvider({
    spanProcessors: [new RedactingSpanProcessor(exporter)],
  })
  const span = provider.getTracer('test').startSpan('GET /users/:id', {
    attributes: {
      'url.full': 'https://example.com/users/123?token=private-token',
      'db.user': 'private-user',
      'db.connection_string': 'postgresql://private-user:private-password@example.com',
      'db.statement': "SELECT 'private-data'",
      'db.query.text': "SELECT 'private-data'",
      'http.route': '/users/:id',
      'db.system': 'postgresql',
    },
  })
  span.recordException(new Error('private-data'))
  span.setStatus({ code: SpanStatusCode.ERROR, message: 'private-data' })
  span.end()
  await provider.forceFlush()

  const [exportedSpan] = exporter.getFinishedSpans()
  expect(exportedSpan?.name).toBe('GET /users/:id')
  expect(exportedSpan?.attributes).toEqual({
    'http.route': '/users/:id',
    'db.system': 'postgresql',
  })
  expect(exportedSpan?.status).toEqual({ code: SpanStatusCode.ERROR })
  expect(exportedSpan?.events[0]?.attributes).toEqual({ 'exception.type': 'Error' })
  await provider.shutdown()
})

test('pg計装の定型文に含まれるエラーコードだけを残す', async () => {
  const exporter = new InMemorySpanExporter()
  const provider = new BasicTracerProvider({
    spanProcessors: [new RedactingSpanProcessor(exporter)],
  })
  const pg = '@opentelemetry/instrumentation-pg'
  const cases = [
    { scope: pg, message: "PostgreSQL error of type 'error' occurred (code: 23505)", expected: '23505' },
    { scope: pg, message: "PostgreSQL error of type 'Error' occurred (code: ECONNREFUSED)", expected: 'ECONNREFUSED' },
    { scope: pg, message: "PostgreSQL error of type 'Error' occurred (code: private-token)", expected: undefined },
    { scope: 'test', message: "PostgreSQL error of type 'error' occurred (code: 23505)", expected: undefined },
  ]
  for (const { scope, message } of cases) {
    const span = provider.getTracer(scope).startSpan('DB接続の確認')
    span.recordException(message)
    span.setStatus({ code: SpanStatusCode.ERROR, message: 'private-data' })
    span.end()
  }
  await provider.forceFlush()

  const spans = exporter.getFinishedSpans()
  expect(spans.map((span) => span.attributes['error.type'])).toEqual(cases.map(({ expected }) => expected))
  for (const span of spans) {
    expect(span.status).toEqual({ code: SpanStatusCode.ERROR })
    expect(span.events[0]?.attributes).toEqual({})
  }
  await provider.shutdown()
})
