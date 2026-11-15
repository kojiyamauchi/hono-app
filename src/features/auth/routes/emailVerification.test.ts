import { beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { sign } from 'hono/jwt'

import type { EmailVerificationToken } from '@/shared/auth/entities/emailVerification'
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
const { emailVerificationRequestRateLimiter } = await import('../services/emailVerification')

const user: User = {
  id: 1,
  name: 'Taro',
  email: 'taro@example.com',
  password: 'hashed',
  emailVerifiedAt: null,
  createdAt: new Date('2026-06-18T00:00:00.000Z'),
  updatedAt: new Date('2026-06-18T00:00:00.000Z'),
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
  emailVerificationRequestRateLimiter.reset()
})

const createAccessToken = async (userId: number): Promise<string> => {
  return sign({ sub: userId, exp: Math.floor(Date.now() / 1000) + 60 }, 'test-secret')
}

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
