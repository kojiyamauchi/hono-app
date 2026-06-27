import type { ContextManager, TracerProvider } from '@opentelemetry/api'
import { context, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import type { Instrumentation } from '@opentelemetry/instrumentation'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BasicTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'

import { createDatabaseSpanInstrumentations } from './db'

type TelemetryDisabledReason = 'invalid-endpoint' | 'missing-endpoint' | 'missing-headers' | 'sdk-disabled' | 'startup-error' | 'traces-disabled'

type TelemetryConfig =
  | {
      enabled: false
      reason: TelemetryDisabledReason
    }
  | {
      enabled: true
      endpoint: string
      headers: Record<string, string>
      serviceName: string
    }

type TelemetryProvider = TracerProvider & {
  forceFlush: () => Promise<void>
  shutdown: () => Promise<void>
}

type TelemetryContextManager = ContextManager

type TelemetryDependencies = {
  createContextManager: () => TelemetryContextManager
  createDatabaseSpanInstrumentations: () => Instrumentation[]
  createProvider: (config: TelemetryConfig & { enabled: true }) => TelemetryProvider
  disableContext: () => void
  disableTrace: () => void
  registerInstrumentations: (instrumentations: Instrumentation[], provider: TelemetryProvider) => () => void
  registerContextManager: (manager: TelemetryContextManager) => boolean
  registerTracerProvider: (provider: TelemetryProvider) => boolean
}

type TelemetryState =
  | {
      enabled: false
      reason: TelemetryDisabledReason
      shutdown: () => Promise<void>
    }
  | {
      enabled: true
      shutdown: () => Promise<void>
    }

const DEFAULT_SERVICE_NAME = 'hono-app'
const ENABLED_VALUE = 'true'

let telemetryState: TelemetryState | undefined

const defaultTelemetryDependencies: TelemetryDependencies = {
  createContextManager: () => new AsyncLocalStorageContextManager(),
  createDatabaseSpanInstrumentations,
  createProvider: (config) => {
    const exporter = new OTLPTraceExporter({
      headers: config.headers,
      url: config.endpoint,
    })

    return new BasicTracerProvider({
      resource: resourceFromAttributes({
        'service.name': config.serviceName,
      }),
      spanProcessors: [new BatchSpanProcessor(exporter)],
    })
  },
  disableContext: () => context.disable(),
  disableTrace: () => trace.disable(),
  registerInstrumentations: (instrumentations, provider) =>
    registerInstrumentations({
      instrumentations,
      tracerProvider: provider,
    }),
  registerContextManager: (manager) => context.setGlobalContextManager(manager.enable()),
  registerTracerProvider: (provider) => trace.setGlobalTracerProvider(provider),
}

/**
 * OpenTelemetryの有効化に必要な環境変数を解決する。
 */
export const resolveTelemetryConfig = (env: NodeJS.ProcessEnv = process.env): TelemetryConfig => {
  if (env.OTEL_SDK_DISABLED === ENABLED_VALUE) {
    return { enabled: false, reason: 'sdk-disabled' }
  }

  if (env.OTEL_TRACES_ENABLED !== ENABLED_VALUE) {
    return { enabled: false, reason: 'traces-disabled' }
  }

  const endpoint = resolveTracesEndpoint(env)

  if (!endpoint) {
    return { enabled: false, reason: 'missing-endpoint' }
  }

  if (!isValidUrl(endpoint)) {
    return { enabled: false, reason: 'invalid-endpoint' }
  }

  const headers = parseOtelHeaders(env.OTEL_EXPORTER_OTLP_TRACES_HEADERS ?? env.OTEL_EXPORTER_OTLP_HEADERS)

  if (Object.keys(headers).length === 0) {
    return { enabled: false, reason: 'missing-headers' }
  }

  return {
    enabled: true,
    endpoint,
    headers,
    serviceName: env.OTEL_SERVICE_NAME?.trim() || DEFAULT_SERVICE_NAME,
  }
}

/**
 * OpenTelemetryの初期化を一度だけ実行する。
 */
export const initializeTelemetry = (
  env: NodeJS.ProcessEnv = process.env,
  dependencies: TelemetryDependencies = defaultTelemetryDependencies,
): TelemetryState => {
  if (telemetryState) {
    return telemetryState
  }

  const config = resolveTelemetryConfig(env)

  if (!config.enabled) {
    telemetryState = {
      enabled: false,
      reason: config.reason,
      shutdown: async () => {},
    }
    return telemetryState
  }

  try {
    const provider = dependencies.createProvider(config)
    const contextManager = dependencies.createContextManager()
    const unregisterInstrumentations = dependencies.registerInstrumentations(dependencies.createDatabaseSpanInstrumentations(), provider)

    const isContextManagerRegistered = dependencies.registerContextManager(contextManager)
    const isTracerProviderRegistered = dependencies.registerTracerProvider(provider)

    if (!isContextManagerRegistered || !isTracerProviderRegistered) {
      console.error('OpenTelemetryのglobal登録に失敗しました', {
        contextManager: isContextManagerRegistered,
        tracerProvider: isTracerProviderRegistered,
      })
    }

    telemetryState = {
      enabled: true,
      shutdown: async () => {
        await provider.forceFlush()
        unregisterInstrumentations()
        await provider.shutdown()
        dependencies.disableContext()
        dependencies.disableTrace()
        telemetryState = undefined
      },
    }
    return telemetryState
  } catch (error) {
    console.error('OpenTelemetryの初期化に失敗しました', error)
    dependencies.disableContext()
    dependencies.disableTrace()

    telemetryState = {
      enabled: false,
      reason: 'startup-error',
      shutdown: async () => {
        telemetryState = undefined
      },
    }
    return telemetryState
  }
}

/**
 * 終了時に未送信spanのflushとSDKの停止を行う。
 */
export const shutdownTelemetry = async (): Promise<void> => {
  await telemetryState?.shutdown()
}

/**
 * テスト間でOpenTelemetryのglobal状態を残さないよう初期化状態を戻す。
 */
export const resetTelemetryForTest = async (): Promise<void> => {
  await shutdownTelemetry()
  context.disable()
  trace.disable()
  telemetryState = undefined
}

/**
 * OTLP header環境変数をexporterへ渡せる連想配列へ変換する。
 */
export const parseOtelHeaders = (raw: string | undefined): Record<string, string> => {
  if (!raw) {
    return {}
  }

  return raw.split(',').reduce<Record<string, string>>((headers, pair) => {
    const separatorIndex = pair.indexOf('=')

    if (separatorIndex <= 0) {
      return headers
    }

    const key = pair.slice(0, separatorIndex).trim()
    const value = pair.slice(separatorIndex + 1).trim()

    if (!key || !value) {
      return headers
    }

    headers[key] = decodeHeaderValue(value)
    return headers
  }, {})
}

const resolveTracesEndpoint = (env: NodeJS.ProcessEnv): string | undefined => {
  const tracesEndpoint = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim()

  if (tracesEndpoint) {
    return tracesEndpoint
  }

  const baseEndpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()

  if (!baseEndpoint) {
    return undefined
  }

  try {
    const url = new URL(baseEndpoint)
    const pathname = url.pathname.replace(/\/+$/, '')
    url.pathname = `${pathname}/v1/traces`
    return url.toString()
  } catch {
    return baseEndpoint
  }
}

const isValidUrl = (value: string): boolean => {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

const decodeHeaderValue = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
