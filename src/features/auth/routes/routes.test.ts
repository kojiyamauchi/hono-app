import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { RefreshToken } from '@/shared/auth/entities'
import type { User } from '@/shared/user/entities'

process.env.JWT_SECRET = 'test-secret'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret'

const create = mock()
const findByTokenHash = mock()
const revokeById = mock()
const revokeFamily = mock()
const rotate = mock()

const findByEmail = mock()
const findById = mock()
const createUser = mock()

await mock.module('@/shared/auth/repositories', () => ({
  refreshTokenRepository: { create, findByTokenHash, revokeById, revokeFamily, rotate },
}))
await mock.module('@/shared/user/repositories', () => ({
  userRepository: { findByEmail, findById, create: createUser },
}))

const { app } = await import('@/app')

const user: User = {
  id: 1,
  name: 'Taro',
  email: 'taro@example.com',
  password: 'hashed',
  createdAt: new Date('2026-06-18T00:00:00.000Z'),
  updatedAt: new Date('2026-06-18T00:00:00.000Z'),
}

const refreshToken: RefreshToken = {
  id: 10,
  userId: 1,
  familyId: 'family-id',
  tokenHash: 'token-hash',
  expiresAt: new Date(Date.now() + 60_000),
  revokedAt: null,
  createdAt: new Date('2026-06-18T00:00:00.000Z'),
}

beforeEach(() => {
  create.mockReset()
  findByTokenHash.mockReset()
  revokeById.mockReset()
  revokeFamily.mockReset()
  rotate.mockReset()
  findByEmail.mockReset()
  findById.mockReset()
  createUser.mockReset()
})

describe('auth refresh/logout routes', () => {
  test('POST /auth/refreshは有効なトークンをローテーションして200を返す', async () => {
    findByTokenHash.mockResolvedValue(refreshToken)
    findById.mockResolvedValue(user)
    rotate.mockResolvedValue({ status: 'ROTATED', refreshToken: { ...refreshToken, id: 11 } })

    const response = await app.request('/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'plain-refresh-token' }),
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { token: string; refreshToken: string; user: { id: number } }
    expect(typeof body.token).toBe('string')
    expect(typeof body.refreshToken).toBe('string')
    expect(body.user.id).toBe(1)
  })

  test('POST /auth/refreshはbodyが不正なら400を返す', async () => {
    const response = await app.request('/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: '' }),
    })

    expect(response.status).toBe(400)
    expect(findByTokenHash).not.toHaveBeenCalled()
  })

  test('POST /auth/refreshは無効なトークンなら401を返す', async () => {
    findByTokenHash.mockResolvedValue(null)

    const response = await app.request('/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'unknown-token' }),
    })

    expect(response.status).toBe(401)
  })

  test('POST /auth/logoutはfamilyを失効して204を返す', async () => {
    findByTokenHash.mockResolvedValue(refreshToken)

    const response = await app.request('/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'plain-refresh-token' }),
    })

    expect(response.status).toBe(204)
    expect(revokeFamily).toHaveBeenCalledWith('family-id')
  })

  test('POST /auth/logoutは存在しないトークンでも204を返す', async () => {
    findByTokenHash.mockResolvedValue(null)

    const response = await app.request('/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'unknown-token' }),
    })

    expect(response.status).toBe(204)
    expect(revokeFamily).not.toHaveBeenCalled()
  })

  test('POST /auth/logoutはbodyが不正なら400を返す', async () => {
    const response = await app.request('/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(400)
    expect(findByTokenHash).not.toHaveBeenCalled()
  })
})
