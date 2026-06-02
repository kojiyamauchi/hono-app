import { app } from './app'

const port = Number(process.env.PORT ?? 3000)

Bun.serve({
  fetch: app.fetch,
  port,
})

console.info(`Server is running on http://localhost:${port}`)
