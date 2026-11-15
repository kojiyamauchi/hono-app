import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { Invitation } from '@/shared/invitation/entities'

process.env.JWT_SECRET = 'test-secret'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret'

const createRefreshToken = mock()

await mock.module('@/shared/auth/repositories/emailVerification', () => ({
  emailVerificationTokenRepository: { create: mock(), deleteByIdAndTokenHash: mock() },
}))

await mock.module('@/shared/auth/repositories/refreshToken', () => ({
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
  createRefreshToken.mockReset()
  sendEmailVerificationBestEffort.mockReset()
})

describe('declineService.execute', () => {
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
    findByToken.mockResolvedValue({ ...pendingInvitation, status: 'UNKNOWN' })

    await expect(declineService.execute(TOKEN)).rejects.toThrow('この招待は利用できません')
    expect(decline).not.toHaveBeenCalled()
  })

  test('declineがfalseを返した場合（競合）は409エラーを投げる', async () => {
    findByToken.mockResolvedValue(pendingInvitation)
    decline.mockResolvedValue(false)

    await expect(declineService.execute(TOKEN)).rejects.toThrow('招待を辞退できませんでした')
  })
})
