import { beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'

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
const { signupRateLimiter } = await import('../services/signup')

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
  signupRateLimiter.reset()
})

describe('POST /auth/signup（Cookie設定・レート制限）', () => {
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

  test('POST /auth/signupは偽装した先頭IPを変えても信頼するエッジが追記した同一IPの制限を回避できない', async () => {
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
            'x-forwarded-for': `198.51.100.${i + 1}, 203.0.113.60`,
          },
          body: JSON.stringify({ name: 'Taro', email: `user-${i}@example.com`, password: 'password123' }),
        })
        expect(response.status).toBe(201)
      }

      const limited = await app.request('/auth/signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '198.51.100.99, 203.0.113.60',
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
