import { describe, expect, test } from 'bun:test'

import {
  createEmailVerificationServiceMock,
  createEmailVerificationTokenRepositoryMock,
  createInvitationRepositoryMock,
  createMembershipRepositoryMock,
  createRefreshTokenRepositoryMock,
  createUserRepositoryMock,
  setTestEnv,
} from './testSupport'

describe('testSupport（invitations Service用helper）', () => {
  test('mock群は呼び出しごとに新しく生成され、参照を共有しない', () => {
    const first = createInvitationRepositoryMock()
    const second = createInvitationRepositoryMock()

    expect(first.mocks).not.toBe(second.mocks)
    expect(first.mocks.findByToken).not.toBe(second.mocks.findByToken)

    first.mocks.findByToken.mockResolvedValue(null)
    expect(second.mocks.findByToken).not.toHaveBeenCalled()
  })

  test('resetは値・once・呼び出し履歴を初期化する', async () => {
    const invitations = createInvitationRepositoryMock()
    invitations.mocks.findByToken.mockResolvedValue(null)
    invitations.mocks.markExpired.mockResolvedValueOnce(undefined)
    await invitations.mocks.findByToken('token')

    invitations.reset()

    expect(invitations.mocks.findByToken).not.toHaveBeenCalled()
    // 実装を持たない初期状態に戻り、戻り値はundefinedになる
    expect(invitations.mocks.findByToken('token')).toBeUndefined()
    expect(invitations.mocks.markExpired(1)).toBeUndefined()
  })

  test('その他のmock群もresetで履歴を消す', async () => {
    const memberships = createMembershipRepositoryMock()
    const users = createUserRepositoryMock()
    const refreshTokens = createRefreshTokenRepositoryMock()
    const emailVerificationTokens = createEmailVerificationTokenRepositoryMock()
    const emailVerificationService = createEmailVerificationServiceMock()

    await memberships.mocks.findByUserAndOrganization(1, 1)
    await users.mocks.findById(1)
    await users.mocks.findByEmail('a@example.com')
    await refreshTokens.mocks.create({ userId: 1, familyId: 'f', tokenHash: 'h', expiresAt: new Date() })
    await emailVerificationTokens.mocks.deleteByIdAndTokenHash(1, 'h')
    await emailVerificationService.mocks.sendEmailVerificationBestEffort(1, 'a@example.com')

    memberships.reset()
    users.reset()
    refreshTokens.reset()
    emailVerificationTokens.reset()
    emailVerificationService.reset()

    expect(memberships.mocks.findByUserAndOrganization).not.toHaveBeenCalled()
    expect(users.mocks.findById).not.toHaveBeenCalled()
    expect(users.mocks.findByEmail).not.toHaveBeenCalled()
    expect(refreshTokens.mocks.create).not.toHaveBeenCalled()
    expect(emailVerificationTokens.mocks.deleteByIdAndTokenHash).not.toHaveBeenCalled()
    expect(emailVerificationService.mocks.sendEmailVerificationBestEffort).not.toHaveBeenCalled()
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
})
