import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { createRefreshTokenFixture, createRouteTestContext } from './testSupport'

const context = await createRouteTestContext()
const { app } = context
const { findByTokenHash, revokeFamily } = context.mocks.refreshTokens

const refreshToken = createRefreshTokenFixture()

beforeEach(() => {
  context.reset()
})

afterEach(() => {
  context.assertNoUnexpectedCalls()
})

afterAll(() => {
  context.cleanup()
})

describe('POST /auth/logout（Cookieベース）', () => {
  test('POST /auth/logoutはfamilyを失効してCookieを削除し204を返す', async () => {
    findByTokenHash.mockResolvedValue(refreshToken)

    const response = await app.request('/auth/logout', {
      method: 'POST',
      headers: { Cookie: 'refreshToken=plain-refresh-token' },
    })

    expect(response.status).toBe(204)
    expect(revokeFamily).toHaveBeenCalledWith('family-id')

    // Cookieが削除されることを確認する（Max-Age=0またはExpires過去日付）
    const setCookie = response.headers.get('set-cookie')
    expect(setCookie).not.toBeNull()
    expect(setCookie).toContain('Path=/auth')
  })

  test('POST /auth/logoutはCookieなしでも204を返す（冪等）', async () => {
    const response = await app.request('/auth/logout', { method: 'POST' })

    expect(response.status).toBe(204)
    expect(revokeFamily).not.toHaveBeenCalled()
  })

  test('POST /auth/logoutは存在しないトークンでも204を返す', async () => {
    findByTokenHash.mockResolvedValue(null)

    const response = await app.request('/auth/logout', {
      method: 'POST',
      headers: { Cookie: 'refreshToken=unknown-token' },
    })

    expect(response.status).toBe(204)
    expect(revokeFamily).not.toHaveBeenCalled()
  })
})
