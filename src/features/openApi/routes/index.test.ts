import { OpenAPIHono } from '@hono/zod-openapi'
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { registerOpenApiRoutes } from '.'

/**
 * root appの読み込みに必要な起動準備（利用先がこのテストだけのため、helperを作らずここに置く）。
 * 1. 変更する環境値の元の存在・値を保存し、テスト値を設定する（接続用の値と挙動フラグはローカル.envに依存させない）
 * 2. @/libs/prisma・@/libs/supabase・@/libs/resendを、呼び出しを記録して例外を投げるstubへ差し替える
 * 3. app import直後とafterEachで記録を検査する
 */
const envValues: Record<string, string | undefined> = {
  // registerRoutes は登録時に ENABLE_API_DOCS を評価するため、app import より前に有効化する。
  ENABLE_API_DOCS: 'true',
  ALLOWED_ORIGINS: 'http://localhost:3000',
  JWT_SECRET: 'test-secret',
  ENABLE_INVITATION_EMAIL: undefined,
  DATABASE_URL: undefined,
  DIRECT_URL: undefined,
  SUPABASE_URL: undefined,
  SUPABASE_PUBLISHABLE_KEY: undefined,
  SUPABASE_ANON_KEY: undefined,
  SUPABASE_SERVICE_ROLE_KEY: undefined,
  RESEND_API_KEY: undefined,
}
const originalEnv = new Map(Object.keys(envValues).map((key) => [key, process.env[key]]))
const restoreEnv = (): void => {
  for (const [key, original] of originalEnv) {
    if (original === undefined) delete process.env[key]
    else process.env[key] = original
  }
}
for (const [key, value] of Object.entries(envValues)) {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

const unexpectedCalls: string[] = []
const createBlockedBoundary = (boundary: string, path: string[] = []): unknown =>
  new Proxy(() => undefined, {
    get: (_target, property) => {
      if (typeof property === 'symbol' || property === 'then') return undefined
      return createBlockedBoundary(boundary, [...path, property])
    },
    apply: () => {
      const operation = `${boundary}.${path.join('.')}`
      unexpectedCalls.push(operation)
      throw new Error(`遮断済みの境界へ想定外の呼び出しがありました: ${operation}`)
    },
  })
const createBlockedFunction = (name: string) => (): never => {
  unexpectedCalls.push(`resend.${name}`)
  throw new Error(`遮断済みの境界へ想定外の呼び出しがありました: resend.${name}`)
}
const assertNoUnexpectedCalls = (): void => {
  if (unexpectedCalls.length > 0) {
    throw new Error(`遮断済みの境界へ想定外の呼び出しが記録されています（${unexpectedCalls.length}件）: ${[...new Set(unexpectedCalls)].join(', ')}`)
  }
}

let rootApp: Awaited<typeof import('@/app')>['app']
try {
  await mock.module('@/libs/prisma', () => ({ prisma: createBlockedBoundary('prisma') }))
  await mock.module('@/libs/supabase', () => ({ supabase: createBlockedBoundary('supabase') }))
  await mock.module('@/libs/resend', () => ({
    sendResendEmail: createBlockedFunction('sendResendEmail'),
    deliverResendEmail: createBlockedFunction('deliverResendEmail'),
    // 読み込み先が値として使うため、実装と同じ値を保持する
    resendDeliveryTimeoutMs: 10_000,
  }))
  // 全featureのAPI定義を含むことの確認用
  ;({ app: rootApp } = await import('@/app'))
  // 起動時の呼び出し記録をケース前に消さないよう、import直後に検査する
  assertNoUnexpectedCalls()
} catch (error) {
  restoreEnv()
  throw error
}

// 各テストでENABLE_API_DOCSを書き換えるため、準備後の値へ戻す。
const preparedEnableApiDocs = process.env.ENABLE_API_DOCS

beforeEach(() => {
  unexpectedCalls.length = 0
})

afterEach(() => {
  process.env.ENABLE_API_DOCS = preparedEnableApiDocs
  assertNoUnexpectedCalls()
})

afterAll(() => {
  try {
    assertNoUnexpectedCalls()
  } finally {
    restoreEnv()
  }
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
