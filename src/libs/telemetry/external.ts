import type { Attributes, Span, Tracer } from '@opentelemetry/api'
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'

type ExternalApiSpanOptions<T> = {
  host?: string
  method?: string
  operation: string
  resolveResult?: (result: T) => ExternalApiSpanResult
  system: string
  tracer?: Tracer
}

type ExternalApiSpanResult = {
  errorType?: string
  statusCode?: number
  success?: boolean
}

/**
 * 外部API呼び出しをHTTP request span配下のclient spanとして計測する。
 * APIキー、Authorization header、メール本文、個人情報は属性へ入れない。
 */
export const traceExternalApiCall = async <T>(options: ExternalApiSpanOptions<T>, callback: () => Promise<T>): Promise<T> => {
  const tracer = options.tracer ?? trace.getTracer('hono-app')

  return tracer.startActiveSpan(
    `${options.system}.${options.operation}`,
    {
      attributes: createExternalApiAttributes(options),
      kind: SpanKind.CLIENT,
    },
    async (span) => {
      try {
        const result = await callback()
        applyExternalApiSpanResult(span, options.resolveResult?.(result) ?? { success: true })
        return result
      } catch (error) {
        applyExternalApiSpanResult(span, {
          errorType: resolveErrorType(error),
          success: false,
        })
        throw error
      } finally {
        span.end()
      }
    },
  )
}

/**
 * 外部API errorオブジェクトからHTTP status相当の数値だけを取り出す。
 */
export const resolveExternalApiStatusCode = (error: unknown): number | undefined => {
  if (!error || typeof error !== 'object') {
    return undefined
  }

  for (const key of ['status', 'statusCode']) {
    const value = (error as Record<string, unknown>)[key]
    if (typeof value === 'number' && Number.isInteger(value)) {
      return value
    }
  }

  return undefined
}

/**
 * URL文字列からhostだけを取り出し、pathやqueryをspan属性へ入れない。
 */
export const resolveExternalApiHost = (url: string | undefined): string | undefined => {
  if (!url) {
    return undefined
  }

  try {
    return new URL(url).host
  } catch {
    return undefined
  }
}

/**
 * 外部API errorオブジェクトから安全なエラー種別だけを取り出す。
 */
export const resolveExternalApiErrorType = (error: unknown): string | undefined => resolveErrorType(error)

const createExternalApiAttributes = <T>(options: ExternalApiSpanOptions<T>): Attributes => {
  const attributes: Attributes = {
    'external.operation': options.operation,
    'external.system': options.system,
  }

  if (options.method) {
    attributes['http.request.method'] = options.method
  }

  if (options.host) {
    attributes['server.address'] = options.host
  }

  return attributes
}

const applyExternalApiSpanResult = (span: Span, result: ExternalApiSpanResult): void => {
  const isSuccess = result.success ?? true
  span.setAttribute('external.success', isSuccess)

  if (result.statusCode !== undefined) {
    span.setAttribute('http.response.status_code', result.statusCode)
  }

  if (!isSuccess) {
    if (result.errorType) {
      span.setAttribute('error.type', result.errorType)
    }
    span.setStatus({ code: SpanStatusCode.ERROR, message: 'external api call failed' })
    return
  }

  span.setStatus({ code: SpanStatusCode.OK })
}

const resolveErrorType = (error: unknown): string | undefined => {
  if (error && typeof error === 'object') {
    const name = (error as { name?: unknown }).name
    if (typeof name === 'string' && name) {
      return name
    }
    return (error as { constructor?: { name?: string } }).constructor?.name ?? 'Error'
  }

  return typeof error
}
