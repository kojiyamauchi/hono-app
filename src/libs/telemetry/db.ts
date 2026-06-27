import type { Instrumentation } from '@opentelemetry/instrumentation'
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg'

/**
 * Prisma adapter-pg経由のPostgreSQLアクセスをOpenTelemetry spanとして計測するinstrumentationを作成する。
 */
export const createDatabaseSpanInstrumentations = (): Instrumentation[] => [
  new PgInstrumentation({
    addSqlCommenterCommentToQueries: false,
    enableTraceContextPropagation: false,
    enhancedDatabaseReporting: false,
    requireParentSpan: true,
  }),
]
