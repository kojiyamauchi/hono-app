import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { sign } from 'hono/jwt'

import { createRouteTestContext, createUserFixture } from './testSupport'

const context = await createRouteTestContext()
const { app } = context
const { revokeAllByUserId } = context.mocks.refreshTokens
const { findById } = context.mocks.users
const user = createUserFixture()

beforeEach(() => {
  context.reset()
})

afterEach(() => {
  context.assertNoUnexpectedCalls()
})

afterAll(() => {
  context.cleanup()
})

const createAccessToken = async (userId: number): Promise<string> => {
  return sign({ sub: userId, exp: Math.floor(Date.now() / 1000) + 60 }, 'test-secret')
}

describe('POST /auth/logout-all', () => {
  test('認証済みユーザーなら全リフレッシュセッションを失効してCookieを削除し204を返す', async () => {
    const token = await createAccessToken(1)
    findById.mockResolvedValue(user)
    revokeAllByUserId.mockResolvedValue(2)

    const response = await app.request('/auth/logout-all', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(revokeAllByUserId).toHaveBeenCalledWith(1)
    // Cookieが削除されることを確認する（Max-Age=0またはExpires過去日付）
    const setCookie = response.headers.get('set-cookie')
    expect(setCookie).not.toBeNull()
    expect(setCookie).toContain('Path=/auth')
  })

  test('未認証の場合は401を返す', async () => {
    const response = await app.request('/auth/logout-all', { method: 'POST' })

    expect(response.status).toBe(401)
    expect(revokeAllByUserId).not.toHaveBeenCalled()
  })

  test('失効対象のリフレッシュセッションが存在しない場合でも204を返す', async () => {
    const token = await createAccessToken(1)
    findById.mockResolvedValue(user)
    revokeAllByUserId.mockResolvedValue(0)

    const response = await app.request('/auth/logout-all', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(204)
  })

  test('Originが許可リストに一致しない場合に403を返す', async () => {
    const token = await createAccessToken(1)

    const response = await app.request('/auth/logout-all', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: 'http://evil.com',
      },
    })

    expect(response.status).toBe(403)
    expect(revokeAllByUserId).not.toHaveBeenCalled()
  })
})
