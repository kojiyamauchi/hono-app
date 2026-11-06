import type { Span, SpanProcessor } from '@opentelemetry/sdk-trace-base'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'

const sensitiveAttributes = ['url.full', 'db.user', 'db.connection_string', 'db.statement', 'db.query.text']
const pgErrorCodePattern =
  /^PostgreSQL error of type '\w+' occurred \(code: ([0-9A-Z]{5}|EAI_AGAIN|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|ETIMEDOUT)\)$/

/** URL・接続情報・SQL・例外の自由記述を除いてから、spanをOTLP送信キューへ入れる。 */
export class RedactingSpanProcessor extends BatchSpanProcessor implements SpanProcessor {
  onEnding(span: Span): void {
    for (const name of sensitiveAttributes) {
      delete span.attributes[name]
    }
    delete span.status.message

    for (const event of span.events) {
      if (event.name === 'exception' && event.attributes) {
        const message = event.attributes['exception.message']
        if (span.instrumentationScope.name === '@opentelemetry/instrumentation-pg' && typeof message === 'string') {
          // pg計装の定型文からSQL標準のエラーコードか既知の接続エラーコードだけを取り出す。
          const code = pgErrorCodePattern.exec(message)?.[1]
          if (code) {
            span.attributes['error.type'] = code
          }
        }
        delete event.attributes['exception.message']
        delete event.attributes['exception.stacktrace']
      }
    }
  }
}
