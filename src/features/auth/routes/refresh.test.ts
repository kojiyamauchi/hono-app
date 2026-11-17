import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { createRefreshTokenFixture, createRouteTestContext, createUserFixture } from './testSupport'

const context = await createRouteTestContext()
const { app } = context
const { findByTokenHash, rotate } = context.mocks.refreshTokens
const { findById } = context.mocks.users
const user = createUserFixture()

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

describe('POST /auth/refresh（Cookieベース）', () => {
  test('POST /auth/refreshはCookieのトークンをローテーションして200を返す', async () => {
    findByTokenHash.mockResolvedValue(refreshToken)
    findById.mockResolvedValue(user)
    rotate.mockResolvedValue({ status: 'ROTATED', refreshToken: { ...refreshToken, id: 11 } })

    const response = await app.request('/auth/refresh', {
      method: 'POST',
      headers: { Cookie: 'refreshToken=plain-refresh-token' },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { token: string; refreshToken?: string; user: { id: number } }
    expect(typeof body.token).toBe('string')
    // bodyにrefreshTokenが含まれないことを確認する
    expect(body.refreshToken).toBeUndefined()
    expect(body.user.id).toBe(1)

    // レスポンスに新しいCookieが含まれることを確認する
    const setCookie = response.headers.get('set-cookie')
    expect(setCookie).not.toBeNull()
    expect(setCookie).toContain('refreshToken=')
  })

  test('POST /auth/refreshはCookieがない場合に401を返す', async () => {
    const response = await app.request('/auth/refresh', { method: 'POST' })

    expect(response.status).toBe(401)
    expect(findByTokenHash).not.toHaveBeenCalled()
  })

  test('POST /auth/refreshは無効なトークンなら401を返す', async () => {
    findByTokenHash.mockResolvedValue(null)

    const response = await app.request('/auth/refresh', {
      method: 'POST',
      headers: { Cookie: 'refreshToken=unknown-token' },
    })

    expect(response.status).toBe(401)
  })
})

describe('POST /auth/refresh（Origin検証）', () => {
  test('POST /auth/refreshはOriginなしでも通す（非ブラウザクライアント考慮）', async () => {
    findByTokenHash.mockResolvedValue(refreshToken)
    findById.mockResolvedValue(user)
    rotate.mockResolvedValue({ status: 'ROTATED', refreshToken: { ...refreshToken, id: 11 } })

    const response = await app.request('/auth/refresh', {
      method: 'POST',
      headers: { Cookie: 'refreshToken=plain-refresh-token' },
    })

    expect(response.status).toBe(200)
  })
})
