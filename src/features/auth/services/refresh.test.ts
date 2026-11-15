import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { RefreshToken } from '@/shared/auth/entities'
import type { User } from '@/shared/user/entities'

// JWT発行に必要なシークレットをテスト用に設定
process.env.JWT_SECRET = 'test-secret'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret'
process.env.PASSWORD_RESET_TOKEN_SECRET = 'test-password-reset-secret'
process.env.EMAIL_VERIFICATION_TOKEN_SECRET = 'test-email-verification-secret'

const createRefreshToken = mock()
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
const prtDeleteByIdAndTokenHash = mock()
const prtConfirm = mock()
const evtFindByTokenHash = mock()
const evtConfirm = mock()

await mock.module('@/shared/auth/repositories', () => ({
  authCredentialRepository: {
    changePassword,
  },
  refreshTokenRepository: {
    create: createRefreshToken,
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
    deleteByIdAndTokenHash: prtDeleteByIdAndTokenHash,
    confirm: prtConfirm,
  },
  emailVerificationTokenRepository: {
    findByTokenHash: evtFindByTokenHash,
    confirm: evtConfirm,
  },
}))

// notifierをモックしてno-op実装を差し替える
const notifierSend = mock()
const sendEmailVerificationBestEffort = mock()

// shared/auth/servicesの実装関数はそのまま使い、passwordResetNotifierのみ差し替える
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

// userRepositoryをモックし、DBに依存せずserviceのロジックを検証する
const findByEmail = mock()
const create = mock()
const findById = mock()

await mock.module('@/shared/user/repositories', () => ({
  userRepository: { findByEmail, create, findById },
}))

const { refreshService } = await import('./refresh')

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

beforeEach(() => {
  createRefreshToken.mockReset()
  findByTokenHash.mockReset()
  revokeById.mockReset()
  revokeFamily.mockReset()
  rotate.mockReset()
  revokeAllByUserId.mockReset()
  revokeByUserIdAndFamilyId.mockReset()
  changePassword.mockReset()
  findActiveSessionsByUserId.mockReset()
  findById.mockReset()
  prtCreate.mockReset()
  prtFindByTokenHash.mockReset()
  prtDeleteByIdAndTokenHash.mockReset()
  prtConfirm.mockReset()
  evtFindByTokenHash.mockReset()
  evtConfirm.mockReset()
  notifierSend.mockReset()
  sendEmailVerificationBestEffort.mockReset()
  passwordResetRequestDelayMs.mockReset()
  passwordResetRequestDelayMs.mockImplementation(() => 0)
})

describe('refreshService.execute', () => {
  beforeEach(() => {
    findByTokenHash.mockResolvedValue(refreshToken)
    findById.mockResolvedValue(user)
    rotate.mockResolvedValue({ status: 'ROTATED', refreshToken: { ...refreshToken, id: 11 } })
  })

  test('有効なトークンをローテーションして新しい認証結果を返す', async () => {
    const result = await refreshService.execute('plain-refresh-token')

    expect(typeof result.token).toBe('string')
    expect(typeof result.refreshToken).toBe('string')
    expect(result.refreshToken).not.toBe('plain-refresh-token')
    expect(result.user.id).toBe(1)
    expect(rotate).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ userId: 1, familyId: 'family-id', tokenHash: expect.any(String), expiresAt: expect.any(Date) }),
    )
  })

  test('存在しないトークンは401エラーを投げる', async () => {
    findByTokenHash.mockResolvedValue(null)

    await expect(refreshService.execute('unknown-token')).rejects.toThrow('リフレッシュトークンが無効です')
    expect(rotate).not.toHaveBeenCalled()
  })

  test('失効済みトークンの再提示はfamilyを失効して401エラーを投げる', async () => {
    findByTokenHash.mockResolvedValue({ ...refreshToken, revokedAt: new Date() })

    await expect(refreshService.execute('revoked-token')).rejects.toThrow('リフレッシュトークンが無効です')
    expect(revokeFamily).toHaveBeenCalledWith('family-id')
    expect(findById).not.toHaveBeenCalled()
  })

  test('期限切れトークンは当該トークンを失効して401エラーを投げる', async () => {
    findByTokenHash.mockResolvedValue({ ...refreshToken, expiresAt: new Date(Date.now() - 1) })

    await expect(refreshService.execute('expired-token')).rejects.toThrow('リフレッシュトークンが無効です')
    expect(revokeById).toHaveBeenCalledWith(10)
    expect(rotate).not.toHaveBeenCalled()
  })

  test('ユーザーが存在しない場合はfamilyを失効して401エラーを投げる', async () => {
    findById.mockResolvedValue(null)

    await expect(refreshService.execute('orphan-token')).rejects.toThrow('リフレッシュトークンが無効です')
    expect(revokeFamily).toHaveBeenCalledWith('family-id')
    expect(rotate).not.toHaveBeenCalled()
  })

  test('条件付き失効が競合した場合はcommit後の再利用結果を401へ変換する', async () => {
    rotate.mockResolvedValue({ status: 'REUSED' })

    await expect(refreshService.execute('reused-token')).rejects.toThrow('リフレッシュトークンが無効です')
  })

  test('未知の結果値はエラー側へ倒れる（fail-closed）', async () => {
    rotate.mockResolvedValue({ status: 'UNKNOWN' })

    await expect(refreshService.execute('unknown-status-token')).rejects.toThrow('リフレッシュトークンが無効です')
  })

  test('アクセストークンを発行できない場合はローテーションしない', async () => {
    const jwtSecret = process.env.JWT_SECRET
    delete process.env.JWT_SECRET

    try {
      await expect(refreshService.execute('plain-refresh-token')).rejects.toThrow('JWT_SECRETが設定されていません')
      expect(rotate).not.toHaveBeenCalled()
    } finally {
      process.env.JWT_SECRET = jwtSecret
    }
  })
})
