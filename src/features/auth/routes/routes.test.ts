import { beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { sign } from 'hono/jwt'

import type { EmailVerificationToken, PasswordResetToken, RefreshToken } from '@/shared/auth/entities'
import type { User } from '@/shared/user/entities'

process.env.JWT_SECRET = 'test-secret'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret'
process.env.PASSWORD_RESET_TOKEN_SECRET = 'test-password-reset-secret'
process.env.EMAIL_VERIFICATION_TOKEN_SECRET = 'test-email-verification-secret'
process.env.ALLOWED_ORIGINS = 'http://localhost:3000'

const create = mock()
const findByTokenHash = mock()
const revokeById = mock()
const revokeFamily = mock()
const rotate = mock()
const revokeAllByUserId = mock()
const revokeByUserIdAndFamilyId = mock()
const changePassword = mock()
const findActiveSessionsByUserId = mock()

const prtCreate = mock()
const prtFindByTokenHash = mock()
const prtDeleteById = mock()
const prtConfirm = mock()
const evtFindByTokenHash = mock()
const evtConfirm = mock()

const findByEmail = mock()
const findById = mock()
const existsById = mock()
const createUser = mock()

await mock.module('@/shared/auth/repositories', () => ({
  authCredentialRepository: { changePassword },
  refreshTokenRepository: {
    create,
    findByTokenHash,
    revokeById,
    revokeFamily,
    rotate,
    revokeAllByUserId,
    revokeByUserIdAndFamilyId,
    findActiveSessionsByUserId,
  },
  passwordResetTokenRepository: {
    create: prtCreate,
    findByTokenHash: prtFindByTokenHash,
    deleteById: prtDeleteById,
    confirm: prtConfirm,
  },
  emailVerificationTokenRepository: {
    findByTokenHash: evtFindByTokenHash,
    confirm: evtConfirm,
  },
}))
await mock.module('@/shared/user/repositories', () => ({
  userRepository: { findByEmail, findById, existsById, create: createUser },
}))

// notifierをモックしてno-op実装を差し替える
const notifierSend = mock()
const sendEmailVerificationBestEffort = mock()
const authServicesModule = await import('@/shared/auth/services')
await mock.module('@/shared/auth/services', () => ({
  ...authServicesModule,
  passwordResetNotifier: { send: notifierSend },
  sendEmailVerificationBestEffort,
}))

const passwordResetRequestDelayMs = mock(() => 0)
await mock.module('@/utils/timing', () => ({
  passwordResetRequestDelayMs,
}))

const { app } = await import('@/app')
const { emailVerificationRequestRateLimiter, passwordResetRequestRateLimiter, loginRateLimiter, signupRateLimiter } = await import('../services')

const user: User = {
  id: 1,
  name: 'Taro',
  email: 'taro@example.com',
  password: 'hashed',
  emailVerifiedAt: null,
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

const emailVerificationToken: EmailVerificationToken = {
  id: 30,
  userId: 1,
  tokenHash: 'hashed-email-verification-token',
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  usedAt: null,
  createdAt: new Date('2026-06-18T00:00:00.000Z'),
}

beforeEach(() => {
  existsById.mockReset()
  existsById.mockResolvedValue(true)
  create.mockReset()
  findByTokenHash.mockReset()
  revokeById.mockReset()
  revokeFamily.mockReset()
  rotate.mockReset()
  revokeAllByUserId.mockReset()
  revokeByUserIdAndFamilyId.mockReset()
  changePassword.mockReset()
  findActiveSessionsByUserId.mockReset()
  prtCreate.mockReset()
  prtFindByTokenHash.mockReset()
  prtDeleteById.mockReset()
  prtConfirm.mockReset()
  evtFindByTokenHash.mockReset()
  evtConfirm.mockReset()
  findByEmail.mockReset()
  findById.mockReset()
  createUser.mockReset()
  notifierSend.mockReset()
  sendEmailVerificationBestEffort.mockReset()
  passwordResetRequestDelayMs.mockReset()
  passwordResetRequestDelayMs.mockImplementation(() => 0)
  passwordResetRequestRateLimiter.reset()
  emailVerificationRequestRateLimiter.reset()
  loginRateLimiter.reset()
  signupRateLimiter.reset()
})

const createAccessToken = async (userId: number): Promise<string> => {
  return sign({ sub: userId, exp: Math.floor(Date.now() / 1000) + 60 }, 'test-secret')
}

describe('auth signup/login routes（Cookie設定）', () => {
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

  test('POST /auth/signupは同一IPからのレート制限超過時に429を返す', async () => {
    findByEmail.mockResolvedValue(null)
    createUser.mockImplementation(async (input: { name: string; email: string; password: string }) => ({
      id: 1,
      name: input.name,
      email: input.email,
      password: input.password,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
    const infoSpy = spyOn(console, 'info').mockImplementation(() => {})

    try {
      for (let i = 0; i < 5; i++) {
        const response = await app.request('/auth/signup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': '203.0.113.60',
          },
          body: JSON.stringify({ name: 'Taro', email: `user-${i}@example.com`, password: 'password123' }),
        })
        expect(response.status).toBe(201)
      }

      const limited = await app.request('/auth/signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '203.0.113.60',
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

describe('GET /auth/sessions', () => {
  test('認証済みなら200を返し、{ sessions: [...] }を返すこと', async () => {
    const token = await createAccessToken(1)
    findById.mockResolvedValue(user)
    const createdAt = new Date('2026-06-01T00:00:00.000Z')
    const expiresAt = new Date('2026-07-01T00:00:00.000Z')
    const lastUsedAt = new Date('2026-06-20T00:00:00.000Z')
    findActiveSessionsByUserId.mockResolvedValue([{ familyId: 'family-uuid-1', createdAt, expiresAt, lastUsedAt }])

    const response = await app.request('/auth/sessions', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { sessions?: Array<{ id?: string; createdAt?: string; expiresAt?: string; lastUsedAt?: string }> }
    expect(Array.isArray(body.sessions)).toBe(true)
    expect(body.sessions).toHaveLength(1)
    // 各セッションにid/createdAt/expiresAt/lastUsedAtが含まれること
    const session = body.sessions?.[0]
    expect(session?.id).toBe('family-uuid-1')
    expect(session?.createdAt).toBeDefined()
    expect(session?.expiresAt).toBeDefined()
    expect(session?.lastUsedAt).toBeDefined()
  })

  test('レスポンスにtokenHashやrefreshToken値などの内部値を含まないこと', async () => {
    const token = await createAccessToken(1)
    findById.mockResolvedValue(user)
    findActiveSessionsByUserId.mockResolvedValue([
      {
        familyId: 'family-uuid-1',
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        expiresAt: new Date('2026-07-01T00:00:00.000Z'),
        lastUsedAt: new Date('2026-06-20T00:00:00.000Z'),
      },
    ])

    const response = await app.request('/auth/sessions', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(200)
    const bodyText = await response.text()
    expect(bodyText).not.toContain('tokenHash')
    expect(bodyText).not.toContain('familyId')
    expect(bodyText).not.toContain('revokedAt')
  })

  test('未認証なら401を返し、findActiveSessionsByUserIdが呼ばれないこと', async () => {
    const response = await app.request('/auth/sessions', { method: 'GET' })

    expect(response.status).toBe(401)
    expect(findActiveSessionsByUserId).not.toHaveBeenCalled()
  })
})

describe('DELETE /auth/sessions/:id', () => {
  const sessionId = '550e8400-e29b-41d4-a716-446655440000'

  test('認証済みかつ有効なUUIDなら指定セッションを失効して204を返す', async () => {
    const token = await createAccessToken(1)
    findById.mockResolvedValue(user)
    revokeByUserIdAndFamilyId.mockResolvedValue(1)

    const response = await app.request(`/auth/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(revokeByUserIdAndFamilyId).toHaveBeenCalledWith(1, sessionId)
  })

  test('未認証なら401を返し、失効処理を呼ばない', async () => {
    const response = await app.request(`/auth/sessions/${sessionId}`, { method: 'DELETE' })

    expect(response.status).toBe(401)
    expect(revokeByUserIdAndFamilyId).not.toHaveBeenCalled()
  })

  test('不正なidなら400を返す', async () => {
    const token = await createAccessToken(1)
    findById.mockResolvedValue(user)

    const response = await app.request('/auth/sessions/not-a-uuid', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(400)
    expect(revokeByUserIdAndFamilyId).not.toHaveBeenCalled()
  })

  test('存在しない・他ユーザー・失効済みのidなら404を返す', async () => {
    const token = await createAccessToken(1)
    findById.mockResolvedValue(user)
    revokeByUserIdAndFamilyId.mockResolvedValue(0)

    const response = await app.request(`/auth/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(404)
  })

  test('Originが許可リストに一致しない場合に403を返す', async () => {
    const token = await createAccessToken(1)

    const response = await app.request(`/auth/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: 'http://evil.com',
      },
    })

    expect(response.status).toBe(403)
    expect(revokeByUserIdAndFamilyId).not.toHaveBeenCalled()
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

describe('POST /auth/email-verification/request', () => {
  test('認証済みの未検証ユーザーなら202を返す', async () => {
    const token = await createAccessToken(1)
    findById.mockResolvedValue(user)

    const response = await app.request('/auth/email-verification/request', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(202)
    expect(await response.text()).toBe('')
    expect(sendEmailVerificationBestEffort).toHaveBeenCalledWith(1, 'taro@example.com')
  })

  test('未認証なら401を返す', async () => {
    const response = await app.request('/auth/email-verification/request', { method: 'POST' })

    expect(response.status).toBe(401)
    expect(sendEmailVerificationBestEffort).not.toHaveBeenCalled()
  })

  test('検証済みユーザーなら409を返す', async () => {
    const token = await createAccessToken(1)
    findById.mockResolvedValue({ ...user, emailVerifiedAt: new Date() })

    const response = await app.request('/auth/email-verification/request', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(409)
    expect(sendEmailVerificationBestEffort).not.toHaveBeenCalled()
  })

  test('ユーザー単位のrate limit超過時は429を返す', async () => {
    const token = await createAccessToken(1)
    findById.mockResolvedValue(user)
    const infoSpy = spyOn(console, 'info').mockImplementation(() => {})

    try {
      for (let i = 0; i < 3; i++) {
        const response = await app.request('/auth/email-verification/request', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
        expect(response.status).toBe(202)
      }

      const response = await app.request('/auth/email-verification/request', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(response.status).toBe(429)
    } finally {
      infoSpy.mockRestore()
    }
  })

  test('許可されていないOriginなら403を返す', async () => {
    const token = await createAccessToken(1)

    const response = await app.request('/auth/email-verification/request', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Origin: 'http://evil.com' },
    })

    expect(response.status).toBe(403)
    expect(findById).not.toHaveBeenCalled()
  })
})

describe('POST /auth/email-verification/confirm', () => {
  test('有効なトークンなら204を返す', async () => {
    evtFindByTokenHash.mockResolvedValue(emailVerificationToken)
    evtConfirm.mockResolvedValue(true)

    const response = await app.request('/auth/email-verification/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'valid-verification-token' }),
    })

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(evtConfirm).toHaveBeenCalledWith(30, 1)
  })

  test('無効・期限切れ・使用済みトークンは401を返す', async () => {
    evtFindByTokenHash.mockResolvedValueOnce(null)
    const invalid = await app.request('/auth/email-verification/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'invalid-token' }),
    })

    evtFindByTokenHash.mockResolvedValueOnce({ ...emailVerificationToken, expiresAt: new Date(Date.now() - 1) })
    const expired = await app.request('/auth/email-verification/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'expired-token' }),
    })

    evtFindByTokenHash.mockResolvedValueOnce({ ...emailVerificationToken, usedAt: new Date() })
    const used = await app.request('/auth/email-verification/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'used-token' }),
    })

    expect(invalid.status).toBe(401)
    expect(expired.status).toBe(401)
    expect(used.status).toBe(401)
  })

  test('tokenが空またはbodyなしなら400を返す', async () => {
    const emptyToken = await app.request('/auth/email-verification/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: '' }),
    })
    const noBody = await app.request('/auth/email-verification/confirm', { method: 'POST' })

    expect(emptyToken.status).toBe(400)
    expect(noBody.status).toBe(400)
    expect(evtFindByTokenHash).not.toHaveBeenCalled()
  })
})
