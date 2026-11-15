import type { OpenAPIHono } from '@hono/zod-openapi'

/** OpenAPI JSONを root app の /open-api/doc へ動的生成して登録する。 */
export const registerDocRoute = (app: OpenAPIHono): void => {
  app.doc('/open-api/doc', {
    openapi: '3.1.0',
    info: {
      title: 'hono-app API',
      version: '0.1.0',
    },
  })
}
