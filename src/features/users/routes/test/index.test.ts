import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { sign } from 'hono/jwt'

import type { User } from '@/shared/user/entities'

import { createRouteTestContext } from './testSupport'

const context = await createRouteTestContext()
const { app } = context
const { findById } = context.mocks.users

const user: User = {
  id: 1,
  name: 'Taro',
  email: 'taro@example.com',
  password: 'hashed-password',
  emailVerifiedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
}

const createToken = async (userId: number): Promise<string> => {
  return sign(
    {
      sub: userId,
      exp: Math.floor(Date.now() / 1000) + 60,
    },
    'test-secret',
  )
}

afterEach(() => {
  context.assertNoUnexpectedCalls()
})

afterAll(() => {
  context.cleanup()
})

describe('users routes', () => {
  beforeEach(() => {
    context.reset()
  })

  test('GET /users/:id は指定ユーザーの公開情報だけを返す', async () => {
    findById.mockResolvedValue({ ...user, id: 2, name: 'Public User', email: 'public@example.com' })
    const token = await createToken(1)

    const response = await app.request('/users/2', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body).toEqual({
      id: 2,
      name: 'Public User',
    })
    expect(body).not.toHaveProperty('email')
    expect(body).not.toHaveProperty('password')
  })

  test('GET /users/:id は不正なIDなら400を返す', async () => {
    const token = await createToken(1)

    const response = await app.request('/users/me-invalid', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(400)
  })
})
