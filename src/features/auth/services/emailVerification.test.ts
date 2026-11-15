import { beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'

import type { EmailVerificationToken } from '@/shared/auth/entities'
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

const { emailVerificationService, emailVerificationRequestRateLimiter, EMAIL_VERIFICATION_USER_RATE_LIMIT, EMAIL_VERIFICATION_USER_RATE_LIMIT_WINDOW_MS } =
  await import('./emailVerification')

const user: User = {
  id: 1,
  name: 'Taro',
  email: 'taro@example.com',
  password: 'hashed',
  emailVerifiedAt: null,
  createdAt: new Date('2026-06-18T00:00:00.000Z'),
  updatedAt: new Date('2026-06-18T00:00:00.000Z'),
}

const savedEmailVerificationToken: EmailVerificationToken = {
  id: 30,
  userId: 1,
  tokenHash: 'hashed-email-verification-token',
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  usedAt: null,
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
  emailVerificationRequestRateLimiter.reset()
})

describe('emailVerificationService.request', () => {
  test('未検証ユーザーへ検証メールを送信する', async () => {
    findById.mockResolvedValue(user)

    await expect(emailVerificationService.request(1)).resolves.toBeUndefined()

    expect(sendEmailVerificationBestEffort).toHaveBeenCalledWith(1, 'taro@example.com')
  })

  test('検証済みユーザーは409エラーを投げる', async () => {
    findById.mockResolvedValue({ ...user, emailVerifiedAt: new Date() })

    await expect(emailVerificationService.request(1)).rejects.toMatchObject({ statusCode: 409 })
    expect(sendEmailVerificationBestEffort).not.toHaveBeenCalled()
  })

  test('ユーザーが存在しない場合は404エラーを投げる', async () => {
    findById.mockResolvedValue(null)

    await expect(emailVerificationService.request(1)).rejects.toMatchObject({ statusCode: 404 })
    expect(sendEmailVerificationBestEffort).not.toHaveBeenCalled()
  })

  test('同一ユーザーで3回送信後の次の試行は429エラーを投げる', async () => {
    findById.mockResolvedValue(user)
    const infoSpy = spyOn(console, 'info').mockImplementation(() => {})

    try {
      for (let i = 0; i < EMAIL_VERIFICATION_USER_RATE_LIMIT; i++) {
        await expect(emailVerificationService.request(1)).resolves.toBeUndefined()
      }
      sendEmailVerificationBestEffort.mockClear()

      await expect(emailVerificationService.request(1)).rejects.toMatchObject({ statusCode: 429 })
      expect(sendEmailVerificationBestEffort).not.toHaveBeenCalled()
      expect(infoSpy).toHaveBeenCalledWith('メールアドレス検証メールの再送をユーザー単位で制限しました', expect.objectContaining({ scope: 'user' }))
    } finally {
      infoSpy.mockRestore()
    }
  })

  test('rate limitは3回・60分である', () => {
    expect(EMAIL_VERIFICATION_USER_RATE_LIMIT).toBe(3)
    expect(EMAIL_VERIFICATION_USER_RATE_LIMIT_WINDOW_MS).toBe(3_600_000)
  })
})

describe('emailVerificationService.confirm', () => {
  test('有効なトークンをhash化して検証済みにする', async () => {
    evtFindByTokenHash.mockResolvedValue(savedEmailVerificationToken)
    evtConfirm.mockResolvedValue(true)

    await expect(emailVerificationService.confirm('plain-verification-token')).resolves.toBeUndefined()

    const tokenHash = evtFindByTokenHash.mock.calls[0][0] as string
    expect(tokenHash).not.toBe('plain-verification-token')
    expect(tokenHash).toHaveLength(64)
    expect(evtConfirm).toHaveBeenCalledWith(savedEmailVerificationToken.id, savedEmailVerificationToken.userId)
  })

  test('存在しないトークンは401エラーを投げる', async () => {
    evtFindByTokenHash.mockResolvedValue(null)

    await expect(emailVerificationService.confirm('unknown-token')).rejects.toMatchObject({ statusCode: 401 })
    expect(evtConfirm).not.toHaveBeenCalled()
  })

  test('期限切れトークンは401エラーを投げる', async () => {
    evtFindByTokenHash.mockResolvedValue({ ...savedEmailVerificationToken, expiresAt: new Date(Date.now() - 1) })

    await expect(emailVerificationService.confirm('expired-token')).rejects.toMatchObject({ statusCode: 401 })
    expect(evtConfirm).not.toHaveBeenCalled()
  })

  test('使用済みトークンは401エラーを投げる', async () => {
    evtFindByTokenHash.mockResolvedValue({ ...savedEmailVerificationToken, usedAt: new Date() })

    await expect(emailVerificationService.confirm('used-token')).rejects.toMatchObject({ statusCode: 401 })
    expect(evtConfirm).not.toHaveBeenCalled()
  })

  test('並行競合でconfirmがfalseなら401エラーを投げる', async () => {
    evtFindByTokenHash.mockResolvedValue(savedEmailVerificationToken)
    evtConfirm.mockResolvedValue(false)

    await expect(emailVerificationService.confirm('concurrent-token')).rejects.toMatchObject({ statusCode: 401 })
  })
})
