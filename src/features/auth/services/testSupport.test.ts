import { describe, expect, test } from 'bun:test'

import {
  createCredentialRepositoryMock,
  createEmailVerificationServiceMock,
  createPasswordResetDelayMock,
  createPasswordResetNotifierMock,
  createPasswordResetTokenRepositoryMock,
  createRefreshTokenRepositoryMock,
  createUserRepositoryMock,
  setTestEnv,
} from './testSupport'

describe('testSupport（auth Service用helper）', () => {
  test('mock群は呼び出しごとに新しく生成され、参照を共有しない', () => {
    const first = createRefreshTokenRepositoryMock()
    const second = createRefreshTokenRepositoryMock()

    expect(first.mocks).not.toBe(second.mocks)
    expect(first.mocks.findByTokenHash).not.toBe(second.mocks.findByTokenHash)

    first.mocks.findByTokenHash.mockResolvedValue(null)
    expect(second.mocks.findByTokenHash).not.toHaveBeenCalled()
    expect(first.mocks.findByTokenHash).not.toBe(second.mocks.findByTokenHash)
  })

  test('resetは値・once・呼び出し履歴を初期化する', async () => {
    const users = createUserRepositoryMock()
    users.mocks.findById.mockResolvedValue(null)
    users.mocks.findByEmail.mockResolvedValueOnce(null)
    await users.mocks.findById(1)

    users.reset()

    expect(users.mocks.findById).not.toHaveBeenCalled()
    // 実装を持たない初期状態に戻り、戻り値はundefinedになる
    expect(users.mocks.findById(1)).toBeUndefined()
    expect(users.mocks.findByEmail('a@example.com')).toBeUndefined()
  })

  test('リポジトリ・通知のmock群はすべてresetで履歴を消す', async () => {
    const credentials = createCredentialRepositoryMock()
    const passwordResetTokens = createPasswordResetTokenRepositoryMock()
    const emailVerification = createEmailVerificationServiceMock()
    const notifier = createPasswordResetNotifierMock()

    await credentials.mocks.changePassword(1, 'hash')
    await passwordResetTokens.mocks.confirm(1, 1, 'hash')
    await emailVerification.mocks.sendEmailVerificationBestEffort(1, 'a@example.com')
    await notifier.mocks.send({ email: 'a@example.com', token: 't' })

    credentials.reset()
    passwordResetTokens.reset()
    emailVerification.reset()
    notifier.reset()

    expect(credentials.mocks.changePassword).not.toHaveBeenCalled()
    expect(passwordResetTokens.mocks.confirm).not.toHaveBeenCalled()
    expect(emailVerification.mocks.sendEmailVerificationBestEffort).not.toHaveBeenCalled()
    expect(notifier.mocks.send).not.toHaveBeenCalled()
  })

  test('待機時間のmockはreset後も既定値の0msを返す', () => {
    const delay = createPasswordResetDelayMock()
    delay.mocks.passwordResetRequestDelayMs.mockReturnValue(999)
    delay.mocks.passwordResetRequestDelayMs.mockReturnValueOnce(500)
    expect(delay.mocks.passwordResetRequestDelayMs(0)).toBe(500)

    delay.reset()

    expect(delay.mocks.passwordResetRequestDelayMs).not.toHaveBeenCalled()
    expect(delay.mocks.passwordResetRequestDelayMs(0)).toBe(0)
  })

  test('setTestEnvは設定した値を元の存在・値へ戻し、未設定だった値は削除する', () => {
    const existingKey = 'TEST_SUPPORT_EXISTING_VALUE'
    const absentKey = 'TEST_SUPPORT_ABSENT_VALUE'
    process.env[existingKey] = 'original'
    delete process.env[absentKey]

    try {
      const env = setTestEnv({ [existingKey]: 'changed', [absentKey]: 'added' })
      expect(process.env[existingKey]).toBe('changed')
      expect(process.env[absentKey]).toBe('added')

      env.restore()

      expect(process.env[existingKey]).toBe('original')
      expect(absentKey in process.env).toBe(false)
    } finally {
      delete process.env[existingKey]
    }
  })

  test('setTestEnvはundefinedを指定した値を削除し、復元で元の値へ戻す', () => {
    const key = 'TEST_SUPPORT_REMOVED_VALUE'
    process.env[key] = 'original'

    try {
      const env = setTestEnv({ [key]: undefined })
      expect(key in process.env).toBe(false)

      env.restore()

      expect(process.env[key]).toBe('original')
    } finally {
      delete process.env[key]
    }
  })
})
