import { beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'

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

await mock.module('@/shared/auth/repositories/credential', () => ({
  authCredentialRepository: { changePassword },
}))

await mock.module('@/shared/auth/repositories/refreshToken', () => ({
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
}))

await mock.module('@/shared/auth/repositories/passwordReset', () => ({
  passwordResetTokenRepository: {
    create: prtCreate,
    findByTokenHash: prtFindByTokenHash,
    deleteById: prtDeleteById,
    confirm: prtConfirm,
  },
}))

await mock.module('@/shared/auth/repositories/emailVerification', () => ({
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
const { loginRateLimiter } = await import('../services/login')

const user: User = {
  id: 1,
  name: 'Taro',
  email: 'taro@example.com',
  password: 'hashed',
  emailVerifiedAt: null,
  createdAt: new Date('2026-06-18T00:00:00.000Z'),
  updatedAt: new Date('2026-06-18T00:00:00.000Z'),
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
  loginRateLimiter.reset()
})

describe('POST /auth/login（Cookie設定・レート制限）', () => {
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
})

describe('POST /auth/login（Origin検証）', () => {
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
})
