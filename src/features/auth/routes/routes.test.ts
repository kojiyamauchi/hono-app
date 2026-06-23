import { beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'

import type { PasswordResetToken, RefreshToken } from '@/shared/auth/entities'
import type { User } from '@/shared/user/entities'

process.env.JWT_SECRET = 'test-secret'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret'
process.env.PASSWORD_RESET_TOKEN_SECRET = 'test-password-reset-secret'
process.env.ALLOWED_ORIGINS = 'http://localhost:3000'

const create = mock()
const findByTokenHash = mock()
const revokeById = mock()
const revokeFamily = mock()
const rotate = mock()
const revokeAllByUserId = mock()

const prtCreate = mock()
const prtFindByTokenHash = mock()
const prtDeleteById = mock()
const prtConfirm = mock()

const findByEmail = mock()
const findById = mock()
const createUser = mock()

await mock.module('@/shared/auth/repositories', () => ({
  refreshTokenRepository: { create, findByTokenHash, revokeById, revokeFamily, rotate, revokeAllByUserId },
  passwordResetTokenRepository: {
    create: prtCreate,
    findByTokenHash: prtFindByTokenHash,
    deleteById: prtDeleteById,
    confirm: prtConfirm,
  },
}))
await mock.module('@/shared/user/repositories', () => ({
  userRepository: { findByEmail, findById, create: createUser },
}))

// notifierをモックしてno-op実装を差し替える
const notifierSend = mock()
const authServicesModule = await import('@/shared/auth/services')
await mock.module('@/shared/auth/services', () => ({
  ...authServicesModule,
  passwordResetNotifier: { send: notifierSend },
}))

const passwordResetRequestDelayMs = mock(() => 0)
await mock.module('@/utils/timing', () => ({
  passwordResetRequestDelayMs,
}))

const { app } = await import('@/app')
const { passwordResetRequestRateLimiter } = await import('../services')

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

const passwordResetToken: PasswordResetToken = {
  id: 20,
  userId: 1,
  tokenHash: 'hashed-reset-token',
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  usedAt: null,
  createdAt: new Date('2026-06-18T00:00:00.000Z'),
}

beforeEach(() => {
  create.mockReset()
  findByTokenHash.mockReset()
  revokeById.mockReset()
  revokeFamily.mockReset()
  rotate.mockReset()
  revokeAllByUserId.mockReset()
  prtCreate.mockReset()
  prtFindByTokenHash.mockReset()
  prtDeleteById.mockReset()
  prtConfirm.mockReset()
  findByEmail.mockReset()
  findById.mockReset()
  createUser.mockReset()
  notifierSend.mockReset()
  passwordResetRequestDelayMs.mockReset()
  passwordResetRequestDelayMs.mockImplementation(() => 0)
  passwordResetRequestRateLimiter.reset()
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

describe('POST /auth/password-reset/request', () => {
  test('登録済みユーザーでも未登録でも同じ202を返す（登録有無を外部に漏らさない）', async () => {
    findByEmail.mockResolvedValue(user)
    prtCreate.mockResolvedValue(passwordResetToken)
    notifierSend.mockResolvedValue(undefined)

    const registered = await app.request('/auth/password-reset/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'taro@example.com' }),
    })

    expect(registered.status).toBe(202)
    const registeredBody = await registered.text()
    expect(registeredBody).toBe('')

    findByEmail.mockResolvedValue(null)

    const unregistered = await app.request('/auth/password-reset/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'notregistered@example.com' }),
    })

    expect(unregistered.status).toBe(202)
    const unregisteredBody = await unregistered.text()
    expect(unregisteredBody).toBe('')
  })

  test('不正なメール形式は400を返す（validationエラー統一形式）', async () => {
    const response = await app.request('/auth/password-reset/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    })

    expect(response.status).toBe(400)
    const body = (await response.json()) as { error?: { message?: string } }
    expect(body.error).toBeDefined()
    expect(typeof body.error?.message).toBe('string')
  })

  test('レスポンスbodyにトークンやメールアドレスを含めない', async () => {
    findByEmail.mockResolvedValue(user)
    prtCreate.mockResolvedValue(passwordResetToken)
    notifierSend.mockResolvedValue(undefined)

    const response = await app.request('/auth/password-reset/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'taro@example.com' }),
    })

    expect(response.status).toBe(202)
    const body = await response.text()
    expect(body).toBe('')
  })

  test('IP単位のレート制限超過時は429を返し、トークン発行・通知を行わない', async () => {
    findByEmail.mockResolvedValue(null)
    const infoSpy = spyOn(console, 'info').mockImplementation(() => {})

    try {
      for (let i = 0; i < 5; i++) {
        const response = await app.request('/auth/password-reset/request', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': '203.0.113.10',
          },
          body: JSON.stringify({ email: `user-${i}@example.com` }),
        })
        expect(response.status).toBe(202)
      }

      const limited = await app.request('/auth/password-reset/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '203.0.113.10',
        },
        body: JSON.stringify({ email: 'user-6@example.com' }),
      })

      expect(limited.status).toBe(429)
      const body = (await limited.json()) as { error?: { message?: string } }
      expect(body.error?.message).toBe('リクエストが多すぎます。しばらくしてから再試行してください')
      expect(prtCreate).not.toHaveBeenCalled()
      expect(notifierSend).not.toHaveBeenCalled()
    } finally {
      infoSpy.mockRestore()
    }
  })
})

describe('POST /auth/password-reset/confirm', () => {
  test('有効なトークンでパスワードを更新し204を返す', async () => {
    prtFindByTokenHash.mockResolvedValue(passwordResetToken)
    prtConfirm.mockResolvedValue(true)

    const response = await app.request('/auth/password-reset/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'valid-reset-token', password: 'new-password-123' }),
    })

    expect(response.status).toBe(204)
    const body = await response.text()
    expect(body).toBe('')
  })

  test('不正なトークンは401を返す', async () => {
    prtFindByTokenHash.mockResolvedValue(null)

    const response = await app.request('/auth/password-reset/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'invalid-token', password: 'new-password-123' }),
    })

    expect(response.status).toBe(401)
  })

  test('期限切れトークンは401を返す', async () => {
    prtFindByTokenHash.mockResolvedValue({ ...passwordResetToken, expiresAt: new Date(Date.now() - 1) })

    const response = await app.request('/auth/password-reset/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'expired-token', password: 'new-password-123' }),
    })

    expect(response.status).toBe(401)
  })

  test('使用済みトークンは401を返す', async () => {
    prtFindByTokenHash.mockResolvedValue({ ...passwordResetToken, usedAt: new Date() })

    const response = await app.request('/auth/password-reset/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'used-token', password: 'new-password-123' }),
    })

    expect(response.status).toBe(401)
  })

  test('並行競合（confirmがfalse）は401を返す', async () => {
    prtFindByTokenHash.mockResolvedValue(passwordResetToken)
    prtConfirm.mockResolvedValue(false)

    const response = await app.request('/auth/password-reset/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'concurrent-token', password: 'new-password-123' }),
    })

    expect(response.status).toBe(401)
  })

  test('成功レスポンスにトークンやユーザー情報を含めない', async () => {
    prtFindByTokenHash.mockResolvedValue(passwordResetToken)
    prtConfirm.mockResolvedValue(true)

    const response = await app.request('/auth/password-reset/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'valid-reset-token', password: 'new-password-123' }),
    })

    expect(response.status).toBe(204)
    const body = await response.text()
    expect(body).toBe('')
    // Cookieにリフレッシュトークンを含めない
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  test('validationエラーは統一形式の400を返す', async () => {
    const response = await app.request('/auth/password-reset/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: '', password: 'short' }),
    })

    expect(response.status).toBe(400)
    const body = (await response.json()) as { error?: { message?: string } }
    expect(body.error).toBeDefined()
    expect(typeof body.error?.message).toBe('string')
  })
})
