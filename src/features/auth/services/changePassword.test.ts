import { beforeEach, describe, expect, mock, test } from 'bun:test'

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

const { changePasswordService } = await import('./changePassword')

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

describe('changePasswordService.execute', () => {
  test('現在のパスワードが正しい場合は新しいパスワードへ変更する', async () => {
    const hashed = await Bun.password.hash('current-password-123')
    findById.mockResolvedValue({ ...user, password: hashed })
    changePassword.mockResolvedValue(true)

    await expect(changePasswordService.execute(1, 'current-password-123', 'new-password-123')).resolves.toBeUndefined()

    expect(findById).toHaveBeenCalledWith(1)
    expect(changePassword).toHaveBeenCalledTimes(1)
    const [_userId, hashedPassword] = changePassword.mock.calls[0] as [number, string]
    expect(_userId).toBe(1)
    expect(hashedPassword).not.toBe('new-password-123')
    expect(hashedPassword.length).toBeGreaterThan(0)
  })

  test('現在のパスワードが誤っている場合は401エラーを投げる', async () => {
    const hashed = await Bun.password.hash('current-password-123')
    findById.mockResolvedValue({ ...user, password: hashed })

    await expect(changePasswordService.execute(1, 'wrong-password', 'new-password-123')).rejects.toMatchObject({
      statusCode: 401,
    })
    expect(changePassword).not.toHaveBeenCalled()
  })

  test('新しいパスワードが現在のパスワードと同じ場合は400エラーを投げる', async () => {
    const hashed = await Bun.password.hash('current-password-123')
    findById.mockResolvedValue({ ...user, password: hashed })

    await expect(changePasswordService.execute(1, 'current-password-123', 'current-password-123')).rejects.toMatchObject({
      statusCode: 400,
    })
    expect(changePassword).not.toHaveBeenCalled()
  })

  test('ユーザーが存在しない場合は404エラーを投げる', async () => {
    findById.mockResolvedValue(null)

    await expect(changePasswordService.execute(1, 'current-password-123', 'new-password-123')).rejects.toMatchObject({
      statusCode: 404,
    })
    expect(changePassword).not.toHaveBeenCalled()
  })

  test('永続化時に対象ユーザーが存在しなくなった場合は404エラーを投げる', async () => {
    const hashed = await Bun.password.hash('current-password-123')
    findById.mockResolvedValue({ ...user, password: hashed })
    changePassword.mockResolvedValue(false)

    await expect(changePasswordService.execute(1, 'current-password-123', 'new-password-123')).rejects.toMatchObject({
      statusCode: 404,
    })
  })
})
