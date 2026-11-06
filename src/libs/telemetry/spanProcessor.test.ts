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
