import type { Context, ContextManager, TracerProvider } from '@opentelemetry/api'
import { ROOT_CONTEXT } from '@opentelemetry/api'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

import { initializeTelemetry, parseOtelHeaders, resetTelemetryForTest, resolveTelemetryConfig } from './index'

type Dependencies = Parameters<typeof initializeTelemetry>[1]

const createTestDependencies = (
  options: {
    createProviderError?: Error
    isContextManagerRegistered?: boolean
    isTracerProviderRegistered?: boolean
  } = {},
): {
  calls: string[]
  dependencies: Dependencies
  receivedConfig: ReturnType<typeof resolveTelemetryConfig> | undefined
} => {
  const calls: string[] = []
  let receivedConfig: ReturnType<typeof resolveTelemetryConfig> | undefined

  const contextManager: ContextManager = {
    active: () => ROOT_CONTEXT,
    bind: <T>(_context: Context, target: T): T => target,
    disable: () => contextManager,
    enable: () => contextManager,
    with: <A extends unknown[], F extends (...args: A) => ReturnType<F>>(_context: Context, fn: F, thisArg?: ThisParameterType<F>, ...args: A): ReturnType<F> =>
      fn.call(thisArg, ...args),
  }

  const provider: TracerProvider & {
    forceFlush: () => Promise<void>
    shutdown: () => Promise<void>
  } = {
    forceFlush: async () => {
      calls.push('forceFlush')
    },
    getTracer: () => {
      throw new Error('テストではtracerを使いません')
    },
    shutdown: async () => {
      calls.push('providerShutdown')
    },
  }

  return {
    calls,
    dependencies: {
      createContextManager: () => {
        calls.push('createContextManager')
        return contextManager
      },
      createProvider: (config) => {
        calls.push('createProvider')
        receivedConfig = config
        if (options.createProviderError) {
          throw options.createProviderError
        }
        return provider
      },
      disableContext: () => {
        calls.push('disableContext')
      },
      disableTrace: () => {
        calls.push('disableTrace')
      },
      registerContextManager: () => {
        calls.push('registerContextManager')
        return options.isContextManagerRegistered ?? true
      },
      registerTracerProvider: () => {
        calls.push('registerTracerProvider')
        return options.isTracerProviderRegistered ?? true
      },
    },
    get receivedConfig() {
      return receivedConfig
    },
  }
}

afterEach(async () => {
  await resetTelemetryForTest()
})

describe('resolveTelemetryConfig', () => {
  test('明示的に有効化されていない場合はtracesを無効として扱う', () => {
    expect(resolveTelemetryConfig({})).toEqual({
      enabled: false,
      reason: 'traces-disabled',
    })
  })

  test('OTEL_SDK_DISABLED=trueの場合は設定があっても無効にする', () => {
    expect(
      resolveTelemetryConfig({
        OTEL_EXPORTER_OTLP_HEADERS: 'api-key=test-key',
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'https://otlp.nr-data.net:4318/v1/traces',
        OTEL_SDK_DISABLED: 'true',
        OTEL_TRACES_ENABLED: 'true',
      }),
    ).toEqual({
      enabled: false,
      reason: 'sdk-disabled',
    })
  })

  test('endpointまたはheadersが不足している場合は外部送信を有効にしない', () => {
    expect(
      resolveTelemetryConfig({
        OTEL_EXPORTER_OTLP_HEADERS: 'api-key=test-key',
        OTEL_TRACES_ENABLED: 'true',
      }),
    ).toEqual({
      enabled: false,
      reason: 'missing-endpoint',
    })

    expect(
      resolveTelemetryConfig({
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'https://otlp.nr-data.net:4318/v1/traces',
        OTEL_TRACES_ENABLED: 'true',
      }),
    ).toEqual({
      enabled: false,
      reason: 'missing-headers',
    })
  })

  test('endpointのURL形式が不正な場合は外部送信を有効にしない', () => {
    expect(
      resolveTelemetryConfig({
        OTEL_EXPORTER_OTLP_HEADERS: 'api-key=test-key',
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'not-a-url',
        OTEL_TRACES_ENABLED: 'true',
      }),
    ).toEqual({
      enabled: false,
      reason: 'invalid-endpoint',
    })
  })

  test('OTLP設定をNew Relic送信用のtrace設定として解決する', () => {
    expect(
      resolveTelemetryConfig({
        OTEL_EXPORTER_OTLP_HEADERS: 'api-key=test-key',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.nr-data.net:4318',
        OTEL_SERVICE_NAME: 'hono-app-test',
        OTEL_TRACES_ENABLED: 'true',
      }),
    ).toEqual({
      enabled: true,
      endpoint: 'https://otlp.nr-data.net:4318/v1/traces',
      headers: {
        'api-key': 'test-key',
      },
      serviceName: 'hono-app-test',
    })
  })
})

describe('parseOtelHeaders', () => {
  test('カンマ区切りのOTLP headerを連想配列へ変換する', () => {
    expect(parseOtelHeaders('api-key=test-key,x-env=local%20dev')).toEqual({
      'api-key': 'test-key',
      'x-env': 'local dev',
    })
  })

  test('不完全なheader指定は無視する', () => {
    expect(parseOtelHeaders('api-key=,broken,no-key')).toEqual({})
  })
})

describe('initializeTelemetry', () => {
  test('無効設定ではproviderやcontext managerを作成しない', () => {
    const { calls, dependencies } = createTestDependencies()

    const state = initializeTelemetry({}, dependencies)

    expect(state).toMatchObject({
      enabled: false,
      reason: 'traces-disabled',
    })
    expect(calls).toEqual([])
  })

  test('有効設定では一度だけproviderとcontext managerを登録し、shutdownでflushする', async () => {
    const telemetry = createTestDependencies()

    const state = initializeTelemetry(
      {
        OTEL_EXPORTER_OTLP_HEADERS: 'api-key=test-key',
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'https://otlp.nr-data.net:4318/v1/traces',
        OTEL_SERVICE_NAME: 'hono-app-test',
        OTEL_TRACES_ENABLED: 'true',
      },
      telemetry.dependencies,
    )
    const secondState = initializeTelemetry({}, telemetry.dependencies)

    expect(state.enabled).toBe(true)
    expect(secondState).toBe(state)
    expect(telemetry.receivedConfig).toMatchObject({
      enabled: true,
      endpoint: 'https://otlp.nr-data.net:4318/v1/traces',
      headers: {
        'api-key': 'test-key',
      },
      serviceName: 'hono-app-test',
    })
    expect(telemetry.calls).toEqual(['createProvider', 'createContextManager', 'registerContextManager', 'registerTracerProvider'])

    await state.shutdown()

    expect(telemetry.calls).toEqual([
      'createProvider',
      'createContextManager',
      'registerContextManager',
      'registerTracerProvider',
      'forceFlush',
      'providerShutdown',
      'disableContext',
      'disableTrace',
    ])
  })

  test('global登録に失敗した場合はログに残す', async () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {})
    const telemetry = createTestDependencies({
      isTracerProviderRegistered: false,
    })

    const state = initializeTelemetry(
      {
        OTEL_EXPORTER_OTLP_HEADERS: 'api-key=test-key',
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'https://otlp.nr-data.net:4318/v1/traces',
        OTEL_TRACES_ENABLED: 'true',
      },
      telemetry.dependencies,
    )

    expect(state.enabled).toBe(true)
    expect(consoleError).toHaveBeenCalledWith('OpenTelemetryのglobal登録に失敗しました', {
      contextManager: true,
      tracerProvider: false,
    })

    consoleError.mockRestore()
    await state.shutdown()
  })

  test('provider生成に失敗した場合は無効状態へフォールバックしglobal状態を解除する', () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {})
    const telemetry = createTestDependencies({
      createProviderError: new Error('provider failed'),
    })

    const state = initializeTelemetry(
      {
        OTEL_EXPORTER_OTLP_HEADERS: 'api-key=test-key',
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'https://otlp.nr-data.net:4318/v1/traces',
        OTEL_TRACES_ENABLED: 'true',
      },
      telemetry.dependencies,
    )

    expect(state).toMatchObject({
      enabled: false,
      reason: 'startup-error',
    })
    expect(telemetry.calls).toEqual(['createProvider', 'disableContext', 'disableTrace'])
    expect(consoleError).toHaveBeenCalled()

    consoleError.mockRestore()
  })
})
