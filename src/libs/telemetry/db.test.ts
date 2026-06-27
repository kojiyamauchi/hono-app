import { describe, expect, test } from 'bun:test'

import { createDatabaseSpanInstrumentations } from './db'

describe('createDatabaseSpanInstrumentations', () => {
  test('Prisma adapter-pg経由のDB spanをpg instrumentationで計測する', () => {
    const [instrumentation] = createDatabaseSpanInstrumentations()

    expect(instrumentation?.instrumentationName).toBe('@opentelemetry/instrumentation-pg')
  })

  test('DB spanはHTTP request span配下に限定し、query parameter値やSQL改変を送らない', () => {
    const [instrumentation] = createDatabaseSpanInstrumentations()

    expect(instrumentation?.getConfig()).toMatchObject({
      addSqlCommenterCommentToQueries: false,
      enableTraceContextPropagation: false,
      enhancedDatabaseReporting: false,
      requireParentSpan: true,
    })
  })
})
