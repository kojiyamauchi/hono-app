import { expect, test } from 'bun:test'

import { createTraceConsumer, summarizeTrace } from '../measureCpu.mjs'

test('CPUの0msを保持し、tailの認証ヘッダー・IP・本文を出力へ混ぜない', () => {
  const result = summarizeTrace(
    {
      outcome: 'ok',
      cpuTime: 0,
      wallTime: 2,
      event: {
        request: {
          url: 'https://example.invalid/measure/ready?sample=sample-1',
          headers: { authorization: 'private-secret' },
          body: 'private-body',
          cf: { clientIp: 'private-ip' },
        },
      },
      logs: [{ message: [{ cpuMeasurement: { sample: 'sample-1', isolateId: 'isolate-1', operationIndex: 1 } }] }],
    },
    new Set(['sample-1']),
  )
  expect(result).toEqual({ sample: 'sample-1', outcome: 'ok', cpuMs: 0, wallMs: 2, versionId: null, isolateId: 'isolate-1', operationIndex: 1 })
  expect(JSON.stringify(result)).not.toContain('private-')
})

test('CPU上限で中断したログの初回情報も取得し、無関係なリクエストを捨てる', () => {
  const trace = {
    outcome: 'exceededCpu',
    cpuTime: 10,
    wallTime: 10,
    event: { request: { url: 'https://example.invalid/measure/password?sample=sample-1' } },
    logs: [{ message: [JSON.stringify({ cpuMeasurement: { sample: 'sample-1', isolateId: 'isolate-1', operationIndex: 2 } })] }],
  }
  expect(summarizeTrace(trace, new Set(['sample-1']))).toMatchObject({ outcome: 'exceededCpu', operationIndex: 2 })
  expect(summarizeTrace(trace, new Set(['sample-2']))).toBeNull()
})

test('URLのクエリが伏せられても、計測ログのIDで照合できる', () => {
  const trace = {
    outcome: 'ok',
    cpuTime: 4,
    wallTime: 50,
    event: { request: { url: 'https://example.invalid/measure/database' } },
    logs: [{ message: [{ cpuMeasurement: { sample: 'sample-1', isolateId: 'isolate-1', operationIndex: 1 } }] }],
  }
  expect(summarizeTrace(trace, new Set(['sample-1']))).toMatchObject({ sample: 'sample-1', cpuMs: 4, operationIndex: 1 })
})

test('同じリクエストのWorkerとDurable ObjectのCPU時間を区別する', () => {
  const result = summarizeTrace(
    {
      outcome: 'ok',
      cpuTime: 800,
      logs: [{ message: [{ cpuMeasurement: { sample: 'sample-1', scope: 'durable-object' } }] }],
    },
    new Set(['sample-1']),
  )
  expect(result).toMatchObject({ sample: 'sample-1', cpuMs: 800, scope: 'durable-object' })
})

test('分割・連結されたログと文字列内の括弧を読み分け、秘密値を捨てる', () => {
  const results = []
  const consume = createTraceConsumer(new Set(['sample-1']), (value) => results.push(value))
  const raw = JSON.stringify({
    outcome: 'ok',
    cpuTime: 1,
    wallTime: 4,
    event: { request: { url: 'https://example.invalid/?sample=sample-1', headers: { authorization: 'private-{value}-"quoted"' } } },
  })
  consume(raw.slice(0, 25))
  consume(`${raw.slice(25)}\n${raw}`)
  expect(results).toHaveLength(2)
  expect(results[0].cpuMs).toBe(1)
  expect(JSON.stringify(results)).not.toContain('private-')
})
