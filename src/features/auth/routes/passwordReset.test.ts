import { beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'

import type { PasswordResetToken } from '@/shared/auth/entities/passwordReset'
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
const { passwordResetRequestRateLimiter } = await import('../services/passwordReset')

const user: User = {
  id: 1,
  name: 'Taro',
  email: 'taro@example.com',
  password: 'hashed',
  emailVerifiedAt: null,
  createdAt: new Date('2026-06-18T00:00:00.000Z'),
  updatedAt: new Date('2026-06-18T00:00:00.000Z'),
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
