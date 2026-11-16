import { beforeEach, describe, expect, mock, test } from 'bun:test'

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

await mock.module('@/shared/auth/repositories/credential', () => ({
  authCredentialRepository: {
    changePassword,
  },
}))

await mock.module('@/shared/auth/repositories/refreshToken', () => ({
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
}))

await mock.module('@/shared/auth/repositories/passwordReset', () => ({
  passwordResetTokenRepository: {
    create: prtCreate,
    findByTokenHash: prtFindByTokenHash,
    deleteByIdAndTokenHash: prtDeleteByIdAndTokenHash,
    confirm: prtConfirm,
  },
}))

await mock.module('@/shared/auth/repositories/emailVerification', () => ({
  emailVerificationTokenRepository: {
    findByTokenHash: evtFindByTokenHash,
    confirm: evtConfirm,
  },
}))

// notifierをモックしてno-op実装を差し替える
const notifierSend = mock()
const sendEmailVerificationBestEffort = mock()

// shared/auth/servicesの実装関数はそのまま使い、passwordResetNotifierとsendEmailVerificationBestEffortのみ差し替える
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

// userRepositoryをモックし、DBに依存せずserviceのロジックを検証する
const findByEmail = mock()
const create = mock()
const findById = mock()

await mock.module('@/shared/user/repositories', () => ({
  userRepository: { findByEmail, create, findById },
}))

const { logoutAllService } = await import('./logoutAll')

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

describe('logoutAllService.execute', () => {
  test('全リフレッシュトークンを失効させるためrevokeAllByUserIdをuserIdで呼び出す', async () => {
    revokeAllByUserId.mockResolvedValue(2)

    await logoutAllService.execute(1)

    expect(revokeAllByUserId).toHaveBeenCalledWith(1)
  })

  test('失効対象が存在しない場合（revokeAllByUserId が0件）も正常終了する', async () => {
    revokeAllByUserId.mockResolvedValue(0)

    await expect(logoutAllService.execute(1)).resolves.toBeUndefined()
  })
})
