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
const emailVerificationModule = await import('@/shared/auth/services/emailVerification')
await mock.module('@/shared/auth/services/emailVerification', () => ({
  ...emailVerificationModule,
  sendEmailVerificationBestEffort,
}))
const passwordResetModule = await import('@/shared/auth/services/passwordReset')
await mock.module('@/shared/auth/services/passwordReset', () => ({
  ...passwordResetModule,
  passwordResetNotifier: { send: notifierSend },
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
