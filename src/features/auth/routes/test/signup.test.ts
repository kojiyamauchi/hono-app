import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'

import { createRouteTestContext } from './testSupport'

const context = await createRouteTestContext()
const { app } = context
const { findByEmail, create: createUser } = context.mocks.users
const { signupRateLimiter } = await import('../../services/signup')

beforeEach(() => {
  context.reset()
  signupRateLimiter.reset()
})

afterEach(() => {
  context.assertNoUnexpectedCalls()
})

afterAll(() => {
  context.cleanup()
})

describe('POST /auth/signup（Cookie設定・レート制限）', () => {
  test('POST /auth/signupは成功時にSet-Cookieヘッダーが付く', async () => {
    findByEmail.mockResolvedValue(null)
    createUser.mockImplementation(async (input: { name: string; email: string; password: string }) => ({
      id: 1,
      name: input.name,
      email: input.email,
      password: input.password,
      emailVerifiedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))

    const response = await app.request('/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Taro', email: 'taro@example.com', password: 'password123' }),
    })

    expect(response.status).toBe(201)
    const setCookie = response.headers.get('set-cookie')
    expect(setCookie).not.toBeNull()
    expect(setCookie).toContain('refreshToken=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Path=/auth')

    const body = (await response.json()) as { token?: string; refreshToken?: string; user?: { id?: number } }
    expect(typeof body.token).toBe('string')
    // bodyにrefreshTokenが含まれないことを確認する
    expect(body.refreshToken).toBeUndefined()
    expect(body.user?.id).toBe(1)
  })

  test('POST /auth/signupは偽装した先頭IPを変えても信頼するエッジが追記した同一IPの制限を回避できない', async () => {
    findByEmail.mockResolvedValue(null)
    // emailVerifiedAtを含まない既存の入力を保つため、このケースに限って型を迂回する
    createUser.mockImplementation(
      async (input: { name: string; email: string; password: string }) =>
        ({
          id: 1,
          name: input.name,
          email: input.email,
          password: input.password,
          createdAt: new Date(),
          updatedAt: new Date(),
        }) as never,
    )
    const infoSpy = spyOn(console, 'info').mockImplementation(() => {})

    try {
      for (let i = 0; i < 5; i++) {
        const response = await app.request('/auth/signup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': `198.51.100.${i + 1}, 203.0.113.60`,
          },
          body: JSON.stringify({ name: 'Taro', email: `user-${i}@example.com`, password: 'password123' }),
        })
        expect(response.status).toBe(201)
      }

      const limited = await app.request('/auth/signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '198.51.100.99, 203.0.113.60',
        },
        body: JSON.stringify({ name: 'Taro', email: 'user-overflow@example.com', password: 'password123' }),
      })

      expect(limited.status).toBe(429)
      const body = (await limited.json()) as { error?: { message?: string } }
      expect(body.error?.message).toBe('リクエストが多すぎます。しばらくしてから再試行してください')
    } finally {
      infoSpy.mockRestore()
    }
  })
})
