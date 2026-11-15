import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { Invitation, InvitationWithOrganization } from '@/shared/invitation/entities'

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

const { service } = await import('.')

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

beforeEach(() => {
  createRefreshToken.mockReset()
  sendEmailVerificationBestEffort.mockReset()
})

describe('service.getDetailByToken', () => {
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

    const result = await service.getDetailByToken(TOKEN)

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

    const result = await service.getDetailByToken(TOKEN)

    expect(result.status).toBe('EXPIRED')
    // DBは更新しない（markExpiredを呼ばない）
    expect(markExpired).not.toHaveBeenCalled()
  })

  test('ACCEPTEDステータスの招待をstatus=ACCEPTEDで返す', async () => {
    const acceptedWithOrg: InvitationWithOrganization = { ...pendingInvitationWithOrg, status: 'ACCEPTED' }
    findByTokenWithOrganization.mockResolvedValue(acceptedWithOrg)

    const result = await service.getDetailByToken(TOKEN)

    expect(result.status).toBe('ACCEPTED')
    expect(markExpired).not.toHaveBeenCalled()
  })

  test('CANCELEDステータスの招待をstatus=CANCELEDで返す', async () => {
    const canceledWithOrg: InvitationWithOrganization = { ...pendingInvitationWithOrg, status: 'CANCELED' }
    findByTokenWithOrganization.mockResolvedValue(canceledWithOrg)

    const result = await service.getDetailByToken(TOKEN)

    expect(result.status).toBe('CANCELED')
  })

  test('DECLINEDステータスの招待をstatus=DECLINEDで返す', async () => {
    const declinedWithOrg: InvitationWithOrganization = { ...pendingInvitationWithOrg, status: 'DECLINED' }
    findByTokenWithOrganization.mockResolvedValue(declinedWithOrg)

    const result = await service.getDetailByToken(TOKEN)

    expect(result.status).toBe('DECLINED')
  })

  test('EXPIREDステータスの招待をstatus=EXPIREDで返す', async () => {
    const expiredWithOrg: InvitationWithOrganization = { ...pendingInvitationWithOrg, status: 'EXPIRED' }
    findByTokenWithOrganization.mockResolvedValue(expiredWithOrg)

    const result = await service.getDetailByToken(TOKEN)

    expect(result.status).toBe('EXPIRED')
    expect(markExpired).not.toHaveBeenCalled()
  })

  test('トークンに対応する招待が存在しない場合は404エラーを投げる', async () => {
    findByTokenWithOrganization.mockResolvedValue(null)

    await expect(service.getDetailByToken('bad-token')).rejects.toThrow('招待が見つかりません')
  })
})
