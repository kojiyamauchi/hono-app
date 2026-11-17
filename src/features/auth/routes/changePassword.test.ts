import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { sign } from 'hono/jwt'

import { createRouteTestContext, createUserFixture } from './testSupport'

const context = await createRouteTestContext()
const { app } = context
const { changePassword } = context.mocks.credentials
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

describe('POST /auth/change-password', () => {
  test('認証済みユーザーが正しい現在パスワードを指定すると204を返しCookieを削除する', async () => {
    const token = await createAccessToken(1)
    const hashed = await Bun.password.hash('current-password-123')
    findById.mockResolvedValue({ ...user, password: hashed })
    changePassword.mockResolvedValue(true)

    const response = await app.request('/auth/change-password', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        currentPassword: 'current-password-123',
        newPassword: 'new-password-123',
      }),
    })

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(changePassword).toHaveBeenCalledTimes(1)
    expect(response.headers.get('set-cookie')).toContain('refreshToken=')
  })

  test('未認証の場合は401を返す', async () => {
    const response = await app.request('/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'current-password-123',
        newPassword: 'new-password-123',
      }),
    })

    expect(response.status).toBe(401)
    expect(changePassword).not.toHaveBeenCalled()
  })

  test('現在のパスワードが誤っている場合は401を返す', async () => {
    const token = await createAccessToken(1)
    const hashed = await Bun.password.hash('current-password-123')
    findById.mockResolvedValue({ ...user, password: hashed })

    const response = await app.request('/auth/change-password', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        currentPassword: 'wrong-password',
        newPassword: 'new-password-123',
      }),
    })

    expect(response.status).toBe(401)
    expect(changePassword).not.toHaveBeenCalled()
  })

  test('現在のパスワードと新しいパスワードが同じ場合は400を返す', async () => {
    const token = await createAccessToken(1)

    const response = await app.request('/auth/change-password', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        currentPassword: 'same-password-123',
        newPassword: 'same-password-123',
      }),
    })

    expect(response.status).toBe(400)
    expect(findById).not.toHaveBeenCalled()
    expect(changePassword).not.toHaveBeenCalled()
  })
})
