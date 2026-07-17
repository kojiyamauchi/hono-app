import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { Invitation, InvitationWithOrganization } from '@/shared/invitation/entities'
import type { Membership } from '@/shared/membership/entities'
import type { User } from '@/shared/user/entities'

process.env.JWT_SECRET = 'test-secret'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret'

const createRefreshToken = mock()

await mock.module('@/shared/auth/repositories', () => ({
  emailVerificationTokenRepository: { create: mock(), deleteByIdAndTokenHash: mock() },
  refreshTokenRepository: { create: createRefreshToken },
}))

const sendEmailVerificationBestEffort = mock()
const authServicesModule = await import('@/shared/auth/services')
await mock.module('@/shared/auth/services', () => ({
  ...authServicesModule,
  sendEmailVerificationBestEffort,
}))

// repositoryをモックしDB非依存でservice層のロジックを検証する
const findByToken = mock()
const findByTokenWithOrganization = mock()
const markExpired = mock()
const accept = mock()
const decline = mock()
const signup = mock()

const findByUserAndOrganization = mock()

const findById = mock()
const findByEmail = mock()

await mock.module('@/shared/invitation/repositories', () => ({
  invitationRepository: { findByToken, findByTokenWithOrganization, markExpired, accept, decline, signup },
}))
await mock.module('@/shared/membership/repositories', () => ({
  membershipRepository: { findByUserAndOrganization },
}))
await mock.module('@/shared/user/repositories', () => ({
  userRepository: { findById, findByEmail },
}))

const { invitationsService } = await import('.')

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

/** 組織情報付き招待フィクスチャ */
const pendingInvitationWithOrg: InvitationWithOrganization = {
  ...pendingInvitation,
  organization: { id: 10, name: 'Example Organization' },
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

/** 作成されるメンバーシップフィクスチャ */
const createdMembership: Membership = {
  id: 100,
  userId: 5,
  organizationId: 10,
  role: 'MEMBER',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
}

beforeEach(() => {
  createRefreshToken.mockReset()
  sendEmailVerificationBestEffort.mockReset()
})

describe('invitationsService.accept', () => {
  beforeEach(() => {
    findByToken.mockReset()
    findByTokenWithOrganization.mockReset()
    markExpired.mockReset()
    accept.mockReset()
    decline.mockReset()
    signup.mockReset()
    findByUserAndOrganization.mockReset()
    findById.mockReset()
    findByEmail.mockReset()
  })

  test('有効な招待を受諾してMemberDtoTypeを返す', async () => {
    findByToken.mockResolvedValue(pendingInvitation)
    findById.mockResolvedValue(inviteeUser)
    findByUserAndOrganization.mockResolvedValue(null)
    accept.mockResolvedValue(createdMembership)

    const result = await invitationsService.accept(5, TOKEN)

    expect(result.userId).toBe(5)
    expect(result.organizationId).toBe(10)
    expect(result.role).toBe('MEMBER')
    expect(accept).toHaveBeenCalledWith(1, 10, 5, 'MEMBER')
  })

  test('トークンに対応する招待が存在しない場合は404エラーを投げる', async () => {
    findByToken.mockResolvedValue(null)

    await expect(invitationsService.accept(5, 'bad-token')).rejects.toThrow('招待が見つかりません')
    expect(findById).not.toHaveBeenCalled()
  })

  test('ACCEPTED状態の招待は409エラーを投げる', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, status: 'ACCEPTED' })

    await expect(invitationsService.accept(5, TOKEN)).rejects.toThrow('既に受諾済みの招待です')
    expect(findById).not.toHaveBeenCalled()
  })

  test('CANCELED状態の招待は409エラーを投げる', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, status: 'CANCELED' })

    await expect(invitationsService.accept(5, TOKEN)).rejects.toThrow('キャンセル済みの招待です')
    expect(findById).not.toHaveBeenCalled()
  })

  test('EXPIRED状態の招待は409エラーを投げる', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, status: 'EXPIRED' })

    await expect(invitationsService.accept(5, TOKEN)).rejects.toThrow('招待の有効期限が切れています')
    expect(findById).not.toHaveBeenCalled()
  })

  test('DECLINED状態の招待は409エラーを投げる', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, status: 'DECLINED' })

    await expect(invitationsService.accept(5, TOKEN)).rejects.toThrow('既に辞退済みの招待です')
    expect(findById).not.toHaveBeenCalled()
  })

  test('PENDINGでも有効期限切れの場合は遅延失効してから409エラーを投げる', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, expiresAt: pastDate })
    markExpired.mockResolvedValue(undefined)

    await expect(invitationsService.accept(5, TOKEN)).rejects.toThrow('招待の有効期限が切れています')
    expect(markExpired).toHaveBeenCalledWith(1)
    expect(findById).not.toHaveBeenCalled()
  })

  test('未知の結果値はエラー側へ倒れる（fail-closed）', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, status: 'UNKNOWN' })

    await expect(invitationsService.accept(5, TOKEN)).rejects.toThrow('この招待は利用できません')
    expect(findById).not.toHaveBeenCalled()
  })

  test('認証ユーザーのメールと招待のメールが不一致の場合は403エラーを投げる', async () => {
    const otherUser: User = { ...inviteeUser, email: 'other@example.com' }
    findByToken.mockResolvedValue(pendingInvitation)
    findById.mockResolvedValue(otherUser)

    await expect(invitationsService.accept(5, TOKEN)).rejects.toThrow('この招待はあなたのメールアドレス宛てではありません')
    expect(findByUserAndOrganization).not.toHaveBeenCalled()
  })

  test('ユーザーが存在しない場合は404エラーを投げる', async () => {
    findByToken.mockResolvedValue(pendingInvitation)
    findById.mockResolvedValue(null)

    await expect(invitationsService.accept(5, TOKEN)).rejects.toThrow('ユーザーが見つかりません')
    expect(findByUserAndOrganization).not.toHaveBeenCalled()
  })

  test('既にメンバーの場合は409エラーを投げる', async () => {
    findByToken.mockResolvedValue(pendingInvitation)
    findById.mockResolvedValue(inviteeUser)
    findByUserAndOrganization.mockResolvedValue(createdMembership)

    await expect(invitationsService.accept(5, TOKEN)).rejects.toThrow('既にこの組織のメンバーです')
    expect(accept).not.toHaveBeenCalled()
  })

  test('acceptがnullを返した場合（競合）は409エラーを投げる', async () => {
    findByToken.mockResolvedValue(pendingInvitation)
    findById.mockResolvedValue(inviteeUser)
    findByUserAndOrganization.mockResolvedValue(null)
    accept.mockResolvedValue(null)

    await expect(invitationsService.accept(5, TOKEN)).rejects.toThrow('招待を受諾できませんでした')
  })
})

describe('invitationsService.decline', () => {
  beforeEach(() => {
    findByToken.mockReset()
    findByTokenWithOrganization.mockReset()
    markExpired.mockReset()
    accept.mockReset()
    decline.mockReset()
    signup.mockReset()
    findByUserAndOrganization.mockReset()
    findById.mockReset()
    findByEmail.mockReset()
  })

  test('有効なPENDING招待を辞退してvoidを返す', async () => {
    findByToken.mockResolvedValue(pendingInvitation)
    decline.mockResolvedValue(true)

    await expect(invitationsService.decline(TOKEN)).resolves.toBeUndefined()
    expect(decline).toHaveBeenCalledWith(1)
  })

  test('トークンに対応する招待が存在しない場合は404エラーを投げる', async () => {
    findByToken.mockResolvedValue(null)

    await expect(invitationsService.decline('bad-token')).rejects.toThrow('招待が見つかりません')
    expect(decline).not.toHaveBeenCalled()
  })

  test('ACCEPTED状態の招待は409エラーを投げる', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, status: 'ACCEPTED' })

    await expect(invitationsService.decline(TOKEN)).rejects.toThrow('既に受諾済みの招待です')
    expect(decline).not.toHaveBeenCalled()
  })

  test('CANCELED状態の招待は409エラーを投げる', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, status: 'CANCELED' })

    await expect(invitationsService.decline(TOKEN)).rejects.toThrow('キャンセル済みの招待です')
    expect(decline).not.toHaveBeenCalled()
  })

  test('EXPIRED状態の招待は409エラーを投げる', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, status: 'EXPIRED' })

    await expect(invitationsService.decline(TOKEN)).rejects.toThrow('招待の有効期限が切れています')
    expect(decline).not.toHaveBeenCalled()
  })

  test('DECLINED状態の招待は409エラーを投げる', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, status: 'DECLINED' })

    await expect(invitationsService.decline(TOKEN)).rejects.toThrow('既に辞退済みの招待です')
    expect(decline).not.toHaveBeenCalled()
  })

  test('PENDINGでも有効期限切れの場合は遅延失効してから409エラーを投げる', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, expiresAt: pastDate })
    markExpired.mockResolvedValue(undefined)

    await expect(invitationsService.decline(TOKEN)).rejects.toThrow('招待の有効期限が切れています')
    expect(markExpired).toHaveBeenCalledWith(1)
    expect(decline).not.toHaveBeenCalled()
  })

  test('未知の結果値はエラー側へ倒れる（fail-closed）', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, status: 'UNKNOWN' })

    await expect(invitationsService.decline(TOKEN)).rejects.toThrow('この招待は利用できません')
    expect(decline).not.toHaveBeenCalled()
  })

  test('declineがfalseを返した場合（競合）は409エラーを投げる', async () => {
    findByToken.mockResolvedValue(pendingInvitation)
    decline.mockResolvedValue(false)

    await expect(invitationsService.decline(TOKEN)).rejects.toThrow('招待を辞退できませんでした')
  })
})

describe('invitationsService.signup', () => {
  beforeEach(() => {
    findByToken.mockReset()
    findByTokenWithOrganization.mockReset()
    markExpired.mockReset()
    accept.mockReset()
    decline.mockReset()
    signup.mockReset()
    findByUserAndOrganization.mockReset()
    findById.mockReset()
    findByEmail.mockReset()
  })

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

    const result = await invitationsService.signup(TOKEN, 'New Invitee', 'password123')

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

    await expect(invitationsService.signup('bad-token', 'New Invitee', 'password123')).rejects.toThrow('招待が見つかりません')
    expect(findByEmail).not.toHaveBeenCalled()
    expect(signup).not.toHaveBeenCalled()
  })

  test('ACCEPTED状態の招待は409エラーを投げる', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, status: 'ACCEPTED' })

    await expect(invitationsService.signup(TOKEN, 'New Invitee', 'password123')).rejects.toThrow('既に受諾済みの招待です')
    expect(findByEmail).not.toHaveBeenCalled()
  })

  test('CANCELED状態の招待は409エラーを投げる', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, status: 'CANCELED' })

    await expect(invitationsService.signup(TOKEN, 'New Invitee', 'password123')).rejects.toThrow('キャンセル済みの招待です')
    expect(findByEmail).not.toHaveBeenCalled()
  })

  test('EXPIRED状態の招待は409エラーを投げる', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, status: 'EXPIRED' })

    await expect(invitationsService.signup(TOKEN, 'New Invitee', 'password123')).rejects.toThrow('招待の有効期限が切れています')
    expect(findByEmail).not.toHaveBeenCalled()
  })

  test('DECLINED状態の招待は409エラーを投げる', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, status: 'DECLINED' })

    await expect(invitationsService.signup(TOKEN, 'New Invitee', 'password123')).rejects.toThrow('既に辞退済みの招待です')
    expect(findByEmail).not.toHaveBeenCalled()
  })

  test('PENDINGでも有効期限切れの場合は遅延失効してから409エラーを投げる', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, expiresAt: pastDate })
    markExpired.mockResolvedValue(undefined)

    await expect(invitationsService.signup(TOKEN, 'New Invitee', 'password123')).rejects.toThrow('招待の有効期限が切れています')
    expect(markExpired).toHaveBeenCalledWith(1)
    expect(findByEmail).not.toHaveBeenCalled()
  })

  test('未知の結果値はエラー側へ倒れる（fail-closed）', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, status: 'UNKNOWN' })

    await expect(invitationsService.signup(TOKEN, 'New Invitee', 'password123')).rejects.toThrow('この招待は利用できません')
    expect(findByEmail).not.toHaveBeenCalled()
  })

  test('招待メールアドレスのユーザーが既に存在する場合は409エラーを投げる', async () => {
    findByToken.mockResolvedValue(pendingInvitation)
    findByEmail.mockResolvedValue(inviteeUser)

    await expect(invitationsService.signup(TOKEN, 'New Invitee', 'password123')).rejects.toThrow('既に登録')
    expect(findByEmail).toHaveBeenCalledWith('invitee@example.com')
    expect(signup).not.toHaveBeenCalled()
  })

  test('signupがnullを返した場合（競合）は409エラーを投げる', async () => {
    findByToken.mockResolvedValue(pendingInvitation)
    findByEmail.mockResolvedValue(null)
    signup.mockResolvedValue(null)

    await expect(invitationsService.signup(TOKEN, 'New Invitee', 'password123')).rejects.toThrow('招待経由の登録に失敗しました')
  })
})

describe('invitationsService.getDetailByToken', () => {
  beforeEach(() => {
    findByToken.mockReset()
    findByTokenWithOrganization.mockReset()
    markExpired.mockReset()
    accept.mockReset()
    decline.mockReset()
    signup.mockReset()
    findByUserAndOrganization.mockReset()
    findById.mockReset()
    findByEmail.mockReset()
  })

  test('PENDING有効な招待をInvitationDetailDtoTypeで返す', async () => {
    findByTokenWithOrganization.mockResolvedValue(pendingInvitationWithOrg)

    const result = await invitationsService.getDetailByToken(TOKEN)

    expect(result.id).toBe(1)
    expect(result.organization).toEqual({ id: 10, name: 'Example Organization' })
    expect(result.email).toBe('invitee@example.com')
    expect(result.role).toBe('MEMBER')
    expect(result.status).toBe('PENDING')
    expect((result as Record<string, unknown>).token).toBeUndefined()
  })

  test('PENDINGでも期限切れの場合はDBを更新せずstatusをEXPIREDとして返す', async () => {
    const expiredPendingWithOrg: InvitationWithOrganization = {
      ...pendingInvitationWithOrg,
      expiresAt: pastDate,
    }
    findByTokenWithOrganization.mockResolvedValue(expiredPendingWithOrg)

    const result = await invitationsService.getDetailByToken(TOKEN)

    expect(result.status).toBe('EXPIRED')
    // DBは更新しない（markExpiredを呼ばない）
    expect(markExpired).not.toHaveBeenCalled()
  })

  test('ACCEPTEDステータスの招待をstatus=ACCEPTEDで返す', async () => {
    const acceptedWithOrg: InvitationWithOrganization = { ...pendingInvitationWithOrg, status: 'ACCEPTED' }
    findByTokenWithOrganization.mockResolvedValue(acceptedWithOrg)

    const result = await invitationsService.getDetailByToken(TOKEN)

    expect(result.status).toBe('ACCEPTED')
    expect(markExpired).not.toHaveBeenCalled()
  })

  test('CANCELEDステータスの招待をstatus=CANCELEDで返す', async () => {
    const canceledWithOrg: InvitationWithOrganization = { ...pendingInvitationWithOrg, status: 'CANCELED' }
    findByTokenWithOrganization.mockResolvedValue(canceledWithOrg)

    const result = await invitationsService.getDetailByToken(TOKEN)

    expect(result.status).toBe('CANCELED')
  })

  test('DECLINEDステータスの招待をstatus=DECLINEDで返す', async () => {
    const declinedWithOrg: InvitationWithOrganization = { ...pendingInvitationWithOrg, status: 'DECLINED' }
    findByTokenWithOrganization.mockResolvedValue(declinedWithOrg)

    const result = await invitationsService.getDetailByToken(TOKEN)

    expect(result.status).toBe('DECLINED')
  })

  test('EXPIREDステータスの招待をstatus=EXPIREDで返す', async () => {
    const expiredWithOrg: InvitationWithOrganization = { ...pendingInvitationWithOrg, status: 'EXPIRED' }
    findByTokenWithOrganization.mockResolvedValue(expiredWithOrg)

    const result = await invitationsService.getDetailByToken(TOKEN)

    expect(result.status).toBe('EXPIRED')
    expect(markExpired).not.toHaveBeenCalled()
  })

  test('トークンに対応する招待が存在しない場合は404エラーを投げる', async () => {
    findByTokenWithOrganization.mockResolvedValue(null)

    await expect(invitationsService.getDetailByToken('bad-token')).rejects.toThrow('招待が見つかりません')
  })
})
