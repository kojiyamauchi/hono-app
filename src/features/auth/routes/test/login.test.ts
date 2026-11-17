import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'

import { createRouteTestContext, createUserFixture } from './testSupport'

const context = await createRouteTestContext()
const { app } = context
const { findByEmail } = context.mocks.users
const { loginRateLimiter } = await import('../../services/login')

const user = createUserFixture()

beforeEach(() => {
  context.reset()
  loginRateLimiter.reset()
})

afterEach(() => {
  context.assertNoUnexpectedCalls()
})

afterAll(() => {
  context.cleanup()
})

describe('POST /auth/login（Cookie設定・レート制限）', () => {
  test('POST /auth/loginは成功時にSet-Cookieヘッダーが付く', async () => {
    const hashed = await Bun.password.hash('password123')
    findByEmail.mockResolvedValue({ ...user, password: hashed })

    const response = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'taro@example.com', password: 'password123' }),
    })

    expect(response.status).toBe(200)
    const setCookie = response.headers.get('set-cookie')
    expect(setCookie).not.toBeNull()
    expect(setCookie).toContain('refreshToken=')
    expect(setCookie).toContain('HttpOnly')

    const body = (await response.json()) as { token?: string; refreshToken?: string }
    expect(body.refreshToken).toBeUndefined()
  })

  test('POST /auth/loginは同一IPからのレート制限超過時に429を返す', async () => {
    const hashed = await Bun.password.hash('password123')
    findByEmail.mockResolvedValue({ ...user, password: hashed })
    const infoSpy = spyOn(console, 'info').mockImplementation(() => {})

    try {
      for (let i = 0; i < 5; i++) {
        const response = await app.request('/auth/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': '203.0.113.50',
          },
          body: JSON.stringify({ email: `user-${i}@example.com`, password: 'password123' }),
        })
        expect(response.status).toBe(200)
      }

      const limited = await app.request('/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '203.0.113.50',
        },
        body: JSON.stringify({ email: 'user-overflow@example.com', password: 'password123' }),
      })

      expect(limited.status).toBe(429)
      const body = (await limited.json()) as { error?: { message?: string } }
      expect(body.error?.message).toBe('リクエストが多すぎます。しばらくしてから再試行してください')
    } finally {
      infoSpy.mockRestore()
    }
  })
})

describe('POST /auth/login（Origin検証）', () => {
  test('POST /auth/loginはOriginが許可リストに一致する場合に通す', async () => {
    const hashed = await Bun.password.hash('password123')
    findByEmail.mockResolvedValue({ ...user, password: hashed })

    const response = await app.request('/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
      },
      body: JSON.stringify({ email: 'taro@example.com', password: 'password123' }),
    })

    expect(response.status).toBe(200)
  })

  test('POST /auth/loginはOriginが許可リストに一致しない場合に403を返す', async () => {
    const response = await app.request('/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://evil.com',
      },
      body: JSON.stringify({ email: 'taro@example.com', password: 'password123' }),
    })

    expect(response.status).toBe(403)
  })

  test('POST /auth/loginはOrigin=nullの場合に403を返す', async () => {
    const response = await app.request('/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'null',
      },
      body: JSON.stringify({ email: 'taro@example.com', password: 'password123' }),
    })

    expect(response.status).toBe(403)
  })
})
