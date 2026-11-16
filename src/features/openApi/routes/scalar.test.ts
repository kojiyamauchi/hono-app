import { OpenAPIHono } from '@hono/zod-openapi'
import { describe, expect, test } from 'bun:test'

import { registerScalarRoute } from './scalar'

describe('registerScalarRoute', () => {
  test('/open-api/scalar がScalar UIを返す', async () => {
    const app = new OpenAPIHono()
    registerScalarRoute(app)

    const response = await app.request('/open-api/scalar')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    const html = await response.text()
    expect(html).toMatch(/"proxyUrl"\s*:\s*""/)
    expect(html).toMatch(/"persistAuth"\s*:\s*false/)
  })
})
