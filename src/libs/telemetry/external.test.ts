import { context, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { afterEach, describe, expect, test } from 'bun:test'

import { resolveExternalApiHost, resolveExternalApiStatusCode, traceExternalApiCall } from './external'

const createExternalApiSpanTest = (): {
  contextManager: AsyncLocalStorageContextManager
  exporter: InMemorySpanExporter
  provider: BasicTracerProvider
} => {
  const exporter = new InMemorySpanExporter()
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  })
  const contextManager = new AsyncLocalStorageContextManager()

  context.setGlobalContextManager(contextManager.enable())
  trace.setGlobalTracerProvider(provider)

  return { contextManager, exporter, provider }
}

afterEach(() => {
  context.disable()
  trace.disable()
})

describe('traceExternalApiCall', () => {
  test('外部API呼び出しをHTTP request spanの子client spanとして記録する', async () => {
    const { exporter, provider } = createExternalApiSpanTest()
    const tracer = trace.getTracer('external-test')

    await tracer.startActiveSpan('POST /auth/forgot-password', async (parentSpan) => {
      await traceExternalApiCall(
        {
          host: 'api.resend.com',
          method: 'POST',
          operation: 'emails.send',
          resolveResult: () => ({ statusCode: 200, success: true }),
          system: 'resend',
          tracer,
        },
        async () => ({ id: 'email-id' }),
      )
      parentSpan.end()
    })
    await provider.forceFlush()

    const spans = exporter.getFinishedSpans()
    const externalSpan = spans.find((span) => span.name === 'resend.emails.send')
    const parentSpan = spans.find((span) => span.name === 'POST /auth/forgot-password')

    expect(externalSpan).toBeDefined()
    expect(parentSpan).toBeDefined()
    expect(externalSpan?.kind).toBe(SpanKind.CLIENT)
    expect(externalSpan?.spanContext().traceId).toBe(parentSpan?.spanContext().traceId)
    expect(externalSpan?.parentSpanContext?.spanId).toBe(parentSpan?.spanContext().spanId)
    expect(externalSpan?.attributes).toMatchObject({
      'external.operation': 'emails.send',
      'external.success': true,
      'external.system': 'resend',
      'http.request.method': 'POST',
      'http.response.status_code': 200,
      'server.address': 'api.resend.com',
    })
    expect(externalSpan?.status.code).toBe(SpanStatusCode.OK)
  })

  test('外部APIがエラーを返した場合はERROR状態とstatus相当を記録する', async () => {
    const { exporter, provider } = createExternalApiSpanTest()
    const tracer = trace.getTracer('external-test')

    await traceExternalApiCall(
      {
        host: 'example.supabase.co',
        method: 'POST',
        operation: 'auth.signInWithPassword',
        resolveResult: () => ({
          errorType: 'AuthApiError',
          statusCode: 400,
          success: false,
        }),
        system: 'supabase',
        tracer,
      },
      async () => ({ error: { name: 'AuthApiError', status: 400 } }),
    )
    await provider.forceFlush()

    const [span] = exporter.getFinishedSpans()

    expect(span.attributes).toMatchObject({
      'error.type': 'AuthApiError',
      'external.operation': 'auth.signInWithPassword',
      'external.success': false,
      'external.system': 'supabase',
      'http.response.status_code': 400,
    })
    expect(span.status.code).toBe(SpanStatusCode.ERROR)
  })

  test('例外時も機微情報をspan属性へ含めずERROR状態にする', async () => {
    const { exporter, provider } = createExternalApiSpanTest()
    const tracer = trace.getTracer('external-test')
    const secretEmail = 'secret@example.com'
    const secretToken = 'secret-reset-token'

    await expect(
      traceExternalApiCall(
        {
          host: 'api.resend.com',
          method: 'POST',
          operation: 'emails.send',
          system: 'resend',
          tracer,
        },
        async () => {
          throw new Error(`送信失敗: ${secretEmail} ${secretToken}`)
        },
      ),
    ).rejects.toThrow('送信失敗')
    await provider.forceFlush()

    const [span] = exporter.getFinishedSpans()
    const values = Object.values(span.attributes)

    expect(span.status.code).toBe(SpanStatusCode.ERROR)
    expect(values).not.toContain(secretEmail)
    expect(values).not.toContain(secretToken)
    expect(values).not.toContain(`Bearer ${secretToken}`)
  })
})

describe('resolveExternalApiStatusCode', () => {
  test('外部API errorからstatusまたはstatusCodeだけを取り出す', () => {
    expect(resolveExternalApiStatusCode({ status: 401 })).toBe(401)
    expect(resolveExternalApiStatusCode({ statusCode: 429 })).toBe(429)
    expect(resolveExternalApiStatusCode({ status: '401' })).toBeUndefined()
  })
})

describe('resolveExternalApiHost', () => {
  test('URLからhostだけを取り出す', () => {
    expect(resolveExternalApiHost('https://example.supabase.co/auth/v1/user?token=secret')).toBe('example.supabase.co')
    expect(resolveExternalApiHost('not-a-url')).toBeUndefined()
  })
})
