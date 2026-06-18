import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { RefreshToken } from '@/shared/auth/entities'
import type { User } from '@/shared/user/entities'

process.env.JWT_SECRET = 'test-secret'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret'
process.env.ALLOWED_ORIGINS = 'http://localhost:3000'

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

describe('auth signup/login routes（Cookie設定）', () => {
  test('POST /auth/signupは成功時にSet-Cookieヘッダーが付く', async () => {
    findByEmail.mockResolvedValue(null)
    createUser.mockImplementation(async (input: { name: string; email: string; password: string }) => ({
      id: 1,
      name: input.name,
      email: input.email,
      password: input.password,
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
})

describe('auth refresh/logout routes（Cookieベース）', () => {
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

describe('auth routes（Origin検証）', () => {
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
