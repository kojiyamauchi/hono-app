import type { Hono } from 'hono'

export const registerRoutes = (app: Hono): void => {
  app.get('/', (c) => {
    return c.text('Hello Hono Dev Watch')
  })

  app.get('/health', (c) => {
    return c.json({ ok: true })
  })
}
