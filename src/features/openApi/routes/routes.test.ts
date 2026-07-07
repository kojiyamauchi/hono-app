import { OpenAPIHono } from '@hono/zod-openapi'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { registerOpenApiRoutes } from '.'

// 各テストで書き換える環境変数を保存・復元する。
const originalEnableApiDocs = process.env.ENABLE_API_DOCS

afterEach(() => {
  process.env.ENABLE_API_DOCS = originalEnableApiDocs
})

describe('registerOpenApiRoutes', () => {
  describe('ENABLE_API_DOCS=true', () => {
    beforeEach(() => {
      process.env.ENABLE_API_DOCS = 'true'
    })

    test('/open-api/doc がOpenAPI JSONを返す', async () => {
      const app = new OpenAPIHono()
      registerOpenApiRoutes(app)

      const response = await app.request('/open-api/doc')

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        openapi?: string
        components?: { securitySchemes?: Record<string, unknown> }
      }
      expect(body.openapi).toBe('3.1.0')
      // security scheme（Bearer / Cookie）がcomponentsへ登録されている
      expect(body.components?.securitySchemes?.bearerAuth).toBeDefined()
      expect(body.components?.securitySchemes?.cookieAuth).toBeDefined()
    })

    test('/open-api/scalar がScalar UIを返す', async () => {
      const app = new OpenAPIHono()
      registerOpenApiRoutes(app)

      const response = await app.request('/open-api/scalar')

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/html')
    })
  })

  describe('ENABLE_API_DOCS=false', () => {
    beforeEach(() => {
      process.env.ENABLE_API_DOCS = 'false'
    })

    test('/open-api/doc と /open-api/scalar は登録されず404になる', async () => {
      const app = new OpenAPIHono()
      registerOpenApiRoutes(app)

      expect((await app.request('/open-api/doc')).status).toBe(404)
      expect((await app.request('/open-api/scalar')).status).toBe(404)
    })
  })
})
