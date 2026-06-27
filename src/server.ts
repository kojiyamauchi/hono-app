import { initializeTelemetry, shutdownTelemetry } from './libs/telemetry'

initializeTelemetry()

// DB span計測はpgが読み込まれる前にinstrumentation登録が必要なため、appは初期化後に読み込む。
const { app } = await import('./app')
const port = Number(process.env.PORT ?? 3000)

const server = Bun.serve({
  fetch: app.fetch,
  port,
})

console.info(`Server is running on http://localhost:${port}`)

let isShuttingDown = false

/**
 * process signalを受けたときにtraceをflushしてからサーバーを停止する。
 */
const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  if (isShuttingDown) {
    return
  }

  isShuttingDown = true
  console.info(`${signal} received. Shutting down server.`)

  try {
    await server.stop(true)
    await shutdownTelemetry()
    process.exit(0)
  } catch (error) {
    console.error('Server shutdown failed.', error)
    process.exit(1)
  }
}

process.once('SIGTERM', () => {
  void shutdown('SIGTERM')
})

process.once('SIGINT', () => {
  void shutdown('SIGINT')
})
