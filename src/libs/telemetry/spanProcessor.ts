import type { Span, SpanProcessor } from '@opentelemetry/sdk-trace-base'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'

const sensitiveAttributes = ['url.full', 'db.user', 'db.connection_string', 'db.statement', 'db.query.text']

/** URL・接続情報・SQL・例外の自由記述を除いてから、spanをOTLP送信キューへ入れる。 */
export class RedactingSpanProcessor extends BatchSpanProcessor implements SpanProcessor {
  onEnding(span: Span): void {
    for (const name of sensitiveAttributes) {
      delete span.attributes[name]
    }
    delete span.status.message

    for (const event of span.events) {
      if (event.name === 'exception' && event.attributes) {
        delete event.attributes['exception.message']
        delete event.attributes['exception.stacktrace']
      }
    }
  }
}
