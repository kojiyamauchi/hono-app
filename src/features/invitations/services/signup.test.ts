import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import type { Invitation } from '@/shared/invitation/entities'
import type { User } from '@/shared/user/entities'

import {
  createEmailVerificationServiceMock,
  createEmailVerificationTokenRepositoryMock,
  createInvitationRepositoryMock,
  createRefreshTokenRepositoryMock,
  createUserRepositoryMock,
  installEmailVerificationServiceMock,
  installEmailVerificationTokenRepositoryMock,
  installInvitationRepositoryMock,
  installRefreshTokenRepositoryMock,
  installUserRepositoryMock,
  setTestEnv,
} from './testSupport'

// JWT・リフレッシュトークンの発行に必要なシークレットだけをテスト用に設定する。
// EMAIL_VERIFICATION_TOKEN_SECRETは、sendEmailVerificationBestEffort自体を部分mockしており到達しないため設定しない。
const env = setTestEnv({ JWT_SECRET: 'test-secret', REFRESH_TOKEN_SECRET: 'test-refresh-secret' })

const invitations = createInvitationRepositoryMock()
const users = createUserRepositoryMock()
const refreshTokens = createRefreshTokenRepositoryMock()
const emailVerificationService = createEmailVerificationServiceMock()
await installInvitationRepositoryMock(invitations.mocks)
await installUserRepositoryMock(users.mocks)
await installRefreshTokenRepositoryMock(refreshTokens.mocks)
// 実モジュールを読み込む部分mockの前提として、メール検証トークンRepositoryを差し替える（本テストでは呼び出さない）
await installEmailVerificationTokenRepositoryMock(createEmailVerificationTokenRepositoryMock().mocks)
await installEmailVerificationServiceMock(emailVerificationService.mocks)
const { findByToken, markExpired, signup } = invitations.mocks
const { findByEmail } = users.mocks
const { create: createRefreshToken } = refreshTokens.mocks
const { sendEmailVerificationBestEffort } = emailVerificationService.mocks

const { signupService } = await import('./signup')

/** 招待トークン用の固定値 */
const TOKEN = 'test-token-uuid'

/** 未来の有効期限 */
const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

/** 過去の有効期限（期限切れ） */
const pastDate = new Date(Date.now() - 1000)

/** 正常な招待フィクスチャ */
const pendingInvitation: Invitation = {
  id: 1,
  organizationId: 10,
  email: 'invitee@example.com',
  role: 'MEMBER',
  status: 'PENDING',
  token: TOKEN,
  expiresAt: futureDate,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
}

/** 招待されたユーザーフィクスチャ */
const inviteeUser: User = {
  id: 5,
  name: 'Invitee',
  email: 'invitee@example.com',
  password: 'hashed',
  emailVerifiedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

beforeEach(() => {
  invitations.reset()
  users.reset()
  refreshTokens.reset()
  emailVerificationService.reset()
})

afterAll(() => {
  env.restore()
})

describe('signupService.execute', () => {
  test('有効なPENDING招待なら招待メールでユーザー作成しトークンとUserDtoTypeを返す', async () => {
    findByToken.mockResolvedValue(pendingInvitation)
    findByEmail.mockResolvedValue(null)
    signup.mockImplementation(
      async (_invitationId: number, _organizationId: number, email: string, name: string, password: string): Promise<User> => ({
        id: 20,
        name,
        email,
        password,
        emailVerifiedAt: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    )

    const result = await signupService.execute(TOKEN, 'New Invitee', 'password123')

    expect(typeof result.token).toBe('string')
    expect(typeof result.refreshToken).toBe('string')
    expect(result.user.id).toBe(20)
    expect(result.user.email).toBe('invitee@example.com')
    expect(result.user.emailVerified).toBe(false)
    expect(result.user).not.toHaveProperty('password')
    expect(sendEmailVerificationBestEffort).toHaveBeenCalledWith(20, 'invitee@example.com')

    const signupArgs = signup.mock.calls[0]
    expect(signupArgs[0]).toBe(1)
    expect(signupArgs[1]).toBe(10)
    expect(signupArgs[2]).toBe('invitee@example.com')
    expect(signupArgs[3]).toBe('New Invitee')
    expect(signupArgs[4]).not.toBe('password123')
    expect(signupArgs[5]).toBe('MEMBER')
    expect(createRefreshToken).toHaveBeenCalledWith({
      userId: 20,
      familyId: expect.any(String),
      tokenHash: expect.any(String),
      expiresAt: expect.any(Date),
    })
  })

  test('トークンに対応する招待が存在しない場合は404エラーを投げる', async () => {
    findByToken.mockResolvedValue(null)

    await expect(signupService.execute('bad-token', 'New Invitee', 'password123')).rejects.toThrow('招待が見つかりません')
    expect(findByEmail).not.toHaveBeenCalled()
    expect(signup).not.toHaveBeenCalled()
  })

  test('ACCEPTED状態の招待は409エラーを投げる', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, status: 'ACCEPTED' })

    await expect(signupService.execute(TOKEN, 'New Invitee', 'password123')).rejects.toThrow('既に受諾済みの招待です')
    expect(findByEmail).not.toHaveBeenCalled()
  })

  test('CANCELED状態の招待は409エラーを投げる', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, status: 'CANCELED' })

    await expect(signupService.execute(TOKEN, 'New Invitee', 'password123')).rejects.toThrow('キャンセル済みの招待です')
    expect(findByEmail).not.toHaveBeenCalled()
  })

  test('EXPIRED状態の招待は409エラーを投げる', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, status: 'EXPIRED' })

    await expect(signupService.execute(TOKEN, 'New Invitee', 'password123')).rejects.toThrow('招待の有効期限が切れています')
    expect(findByEmail).not.toHaveBeenCalled()
  })

  test('DECLINED状態の招待は409エラーを投げる', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, status: 'DECLINED' })

    await expect(signupService.execute(TOKEN, 'New Invitee', 'password123')).rejects.toThrow('既に辞退済みの招待です')
    expect(findByEmail).not.toHaveBeenCalled()
  })

  test('PENDINGでも有効期限切れの場合は遅延失効してから409エラーを投げる', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, expiresAt: pastDate })
    markExpired.mockResolvedValue(undefined)

    await expect(signupService.execute(TOKEN, 'New Invitee', 'password123')).rejects.toThrow('招待の有効期限が切れています')
    expect(markExpired).toHaveBeenCalledWith(1)
    expect(findByEmail).not.toHaveBeenCalled()
  })

  test('未知の結果値はエラー側へ倒れる（fail-closed）', async () => {
    // 未知のstatusを作るため、このケースに限って型を迂回する
    findByToken.mockResolvedValue({ ...pendingInvitation, status: 'UNKNOWN' } as never)

    await expect(signupService.execute(TOKEN, 'New Invitee', 'password123')).rejects.toThrow('この招待は利用できません')
    expect(findByEmail).not.toHaveBeenCalled()
  })

  test('招待メールアドレスのユーザーが既に存在する場合は409エラーを投げる', async () => {
    findByToken.mockResolvedValue(pendingInvitation)
    findByEmail.mockResolvedValue(inviteeUser)

    await expect(signupService.execute(TOKEN, 'New Invitee', 'password123')).rejects.toThrow('既に登録')
    expect(findByEmail).toHaveBeenCalledWith('invitee@example.com')
    expect(signup).not.toHaveBeenCalled()
  })

  test('signupがnullを返した場合（競合）は409エラーを投げる', async () => {
    findByToken.mockResolvedValue(pendingInvitation)
    findByEmail.mockResolvedValue(null)
    signup.mockResolvedValue(null)

    await expect(signupService.execute(TOKEN, 'New Invitee', 'password123')).rejects.toThrow('招待経由の登録に失敗しました')
  })
})
