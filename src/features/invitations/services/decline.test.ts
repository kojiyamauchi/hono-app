import { beforeEach, describe, expect, test } from 'bun:test'

import type { Invitation } from '@/shared/invitation/entities'

import { createInvitationRepositoryMock, installInvitationRepositoryMock } from './testSupport'

const invitations = createInvitationRepositoryMock()
await installInvitationRepositoryMock(invitations.mocks)
const { findByToken, markExpired, decline } = invitations.mocks

const { declineService } = await import('./decline')

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

beforeEach(() => {
  invitations.reset()
})

describe('declineService.execute', () => {
  test('有効なPENDING招待を辞退してvoidを返す', async () => {
    findByToken.mockResolvedValue(pendingInvitation)
    decline.mockResolvedValue(true)

    await expect(declineService.execute(TOKEN)).resolves.toBeUndefined()
    expect(decline).toHaveBeenCalledWith(1)
  })

  test('トークンに対応する招待が存在しない場合は404エラーを投げる', async () => {
    findByToken.mockResolvedValue(null)

    await expect(declineService.execute('bad-token')).rejects.toThrow('招待が見つかりません')
    expect(decline).not.toHaveBeenCalled()
  })

  test('ACCEPTED状態の招待は409エラーを投げる', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, status: 'ACCEPTED' })

    await expect(declineService.execute(TOKEN)).rejects.toThrow('既に受諾済みの招待です')
    expect(decline).not.toHaveBeenCalled()
  })

  test('CANCELED状態の招待は409エラーを投げる', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, status: 'CANCELED' })

    await expect(declineService.execute(TOKEN)).rejects.toThrow('キャンセル済みの招待です')
    expect(decline).not.toHaveBeenCalled()
  })

  test('EXPIRED状態の招待は409エラーを投げる', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, status: 'EXPIRED' })

    await expect(declineService.execute(TOKEN)).rejects.toThrow('招待の有効期限が切れています')
    expect(decline).not.toHaveBeenCalled()
  })

  test('DECLINED状態の招待は409エラーを投げる', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, status: 'DECLINED' })

    await expect(declineService.execute(TOKEN)).rejects.toThrow('既に辞退済みの招待です')
    expect(decline).not.toHaveBeenCalled()
  })

  test('PENDINGでも有効期限切れの場合は遅延失効してから409エラーを投げる', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, expiresAt: pastDate })
    markExpired.mockResolvedValue(undefined)

    await expect(declineService.execute(TOKEN)).rejects.toThrow('招待の有効期限が切れています')
    expect(markExpired).toHaveBeenCalledWith(1)
    expect(decline).not.toHaveBeenCalled()
  })

  test('未知の結果値はエラー側へ倒れる（fail-closed）', async () => {
    // 未知のstatusを作るため、このケースに限って型を迂回する
    findByToken.mockResolvedValue({ ...pendingInvitation, status: 'UNKNOWN' } as never)

    await expect(declineService.execute(TOKEN)).rejects.toThrow('この招待は利用できません')
    expect(decline).not.toHaveBeenCalled()
  })

  test('declineがfalseを返した場合（競合）は409エラーを投げる', async () => {
    findByToken.mockResolvedValue(pendingInvitation)
    decline.mockResolvedValue(false)

    await expect(declineService.execute(TOKEN)).rejects.toThrow('招待を辞退できませんでした')
  })
})
