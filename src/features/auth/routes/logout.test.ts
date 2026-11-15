import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { RefreshToken } from '@/shared/auth/entities'

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

describe('POST /auth/logout（Cookieベース）', () => {
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
