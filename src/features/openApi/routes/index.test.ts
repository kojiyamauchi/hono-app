import { OpenAPIHono } from '@hono/zod-openapi'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { registerOpenApiRoutes } from '.'

// 各テストで書き換える環境変数を保存・復元する。
const originalEnableApiDocs = process.env.ENABLE_API_DOCS

// 全featureのAPI定義を含むことの確認用。registerRoutes は登録時に ENABLE_API_DOCS を評価するため、app import より前に有効化する。
process.env.ENABLE_API_DOCS = 'true'
const { app: rootApp } = await import('@/app')

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

    test('root appでは /open-api/doc が全featureのAPI定義を含み、/open-api/scalar も公開される', async () => {
      const docResponse = await rootApp.request('/open-api/doc')

      expect(docResponse.status).toBe(200)
      const doc = (await docResponse.json()) as { paths?: Record<string, unknown> }
      const paths = Object.keys(doc.paths ?? {})
      // 各featureの代表パス
      expect(paths).toContain('/auth/login')
      expect(paths).toContain('/supabase-auth/login')
      expect(paths).toContain('/users/me')
      expect(paths).toContain('/organizations')
      expect(paths).toContain('/invitations/{token}')

      expect((await rootApp.request('/open-api/scalar')).status).toBe(200)
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
