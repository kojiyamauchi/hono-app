import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { sign } from 'hono/jwt'

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
