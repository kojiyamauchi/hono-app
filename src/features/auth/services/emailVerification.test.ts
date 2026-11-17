import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'

import type { EmailVerificationToken } from '@/shared/auth/entities/emailVerification'
import type { User } from '@/shared/user/entities'

import {
  createEmailVerificationServiceMock,
  createEmailVerificationTokenRepositoryMock,
  createUserRepositoryMock,
  installEmailVerificationServiceMock,
  installEmailVerificationTokenRepositoryMock,
  installUserRepositoryMock,
  setTestEnv,
} from './testSupport'

// メール検証トークンのハッシュ化に必要なシークレットだけをテスト用に設定する
const env = setTestEnv({ EMAIL_VERIFICATION_TOKEN_SECRET: 'test-email-verification-secret' })

const emailVerificationTokens = createEmailVerificationTokenRepositoryMock()
const users = createUserRepositoryMock()
const emailVerificationNotifier = createEmailVerificationServiceMock()
await installEmailVerificationTokenRepositoryMock(emailVerificationTokens.mocks)
await installUserRepositoryMock(users.mocks)
await installEmailVerificationServiceMock(emailVerificationNotifier.mocks)
const { findByTokenHash: evtFindByTokenHash, confirm: evtConfirm } = emailVerificationTokens.mocks
const { findById } = users.mocks
const { sendEmailVerificationBestEffort } = emailVerificationNotifier.mocks

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
  emailVerificationTokens.reset()
  users.reset()
  emailVerificationNotifier.reset()
  // rate limiterは対象を読み込んだ後に同じインスタンスをresetする
  emailVerificationRequestRateLimiter.reset()
})

afterAll(() => {
  env.restore()
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
