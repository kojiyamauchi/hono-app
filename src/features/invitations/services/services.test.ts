import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { Invitation } from '@/shared/invitation/entities'
import type { Membership } from '@/shared/membership/entities'
import type { User } from '@/shared/user/entities'

// repositoryをモックしDB非依存でservice層のロジックを検証する
const findByToken = mock()
const markExpired = mock()
const accept = mock()
const decline = mock()

const findByUserAndOrganization = mock()

const findById = mock()

await mock.module('@/shared/invitation/repositories', () => ({
  invitationRepository: { findByToken, markExpired, accept, decline },
}))
await mock.module('@/shared/membership/repositories', () => ({
  membershipRepository: { findByUserAndOrganization },
}))
await mock.module('@/shared/user/repositories', () => ({
  userRepository: { findById },
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

/** 招待されたユーザーフィクスチャ */
const inviteeUser: User = {
  id: 5,
  name: 'Invitee',
  email: 'invitee@example.com',
  password: 'hashed',
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

describe('invitationsService.accept', () => {
  beforeEach(() => {
    findByToken.mockReset()
    markExpired.mockReset()
    accept.mockReset()
    decline.mockReset()
    findByUserAndOrganization.mockReset()
    findById.mockReset()
  })

  test('有効な招待を受諾してMemberResponseを返す', async () => {
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
    markExpired.mockReset()
    accept.mockReset()
    decline.mockReset()
    findByUserAndOrganization.mockReset()
    findById.mockReset()
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

  test('declineがfalseを返した場合（競合）は409エラーを投げる', async () => {
    findByToken.mockResolvedValue(pendingInvitation)
    decline.mockResolvedValue(false)

    await expect(invitationsService.decline(TOKEN)).rejects.toThrow('招待を辞退できませんでした')
  })
})
