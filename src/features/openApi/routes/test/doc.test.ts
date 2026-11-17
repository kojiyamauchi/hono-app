import { OpenAPIHono } from '@hono/zod-openapi'
import { describe, expect, test } from 'bun:test'

import { registerDocRoute } from '../doc'

describe('registerDocRoute', () => {
  test('/open-api/doc が仕様バージョンとinfoを含むOpenAPI JSONを返す', async () => {
    const app = new OpenAPIHono()
    registerDocRoute(app)

    const response = await app.request('/open-api/doc')

    expect(response.status).toBe(200)
    const body = (await response.json()) as { openapi?: string; info?: { title?: string; version?: string } }
    expect(body.openapi).toBe('3.1.0')
    expect(body.info).toEqual({ title: 'hono-app API', version: '0.1.0' })
  })
})
