import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { Invitation } from '@/shared/invitation/entities'

process.env.JWT_SECRET = 'test-secret'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret'
process.env.ALLOWED_ORIGINS = 'http://localhost:3000'

const createRefreshToken = mock()

await mock.module('@/shared/auth/repositories', () => ({
  authCredentialRepository: {},
  refreshTokenRepository: { create: createRefreshToken },
  passwordResetTokenRepository: {},
  emailVerificationTokenRepository: { create: mock(), deleteByIdAndTokenHash: mock() },
}))

// repositoryをモックしDB非依存でroute統合を検証する
const findByToken = mock()
const findByTokenWithOrganization = mock()
const markExpired = mock()
const accept = mock()
const decline = mock()
const signup = mock()

const findByUserAndOrganization = mock()

const findById = mock()
const findByEmail = mock()
const existsById = mock()

await mock.module('@/shared/invitation/repositories', () => ({
  invitationRepository: { findByToken, findByTokenWithOrganization, markExpired, accept, decline, signup },
}))
await mock.module('@/shared/membership/repositories', () => ({
  membershipRepository: { findByUserAndOrganization },
}))
await mock.module('@/shared/user/repositories', () => ({
  userRepository: { findById, findByEmail, existsById },
}))

const { app } = await import('@/app')

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

/**
 * JWTトークンを生成する。
 */
describe('invitations decline routes', () => {
  beforeEach(() => {
    existsById.mockReset()
    existsById.mockResolvedValue(true)
    findByToken.mockReset()
    findByTokenWithOrganization.mockReset()
    markExpired.mockReset()
    accept.mockReset()
    decline.mockReset()
    signup.mockReset()
    findByUserAndOrganization.mockReset()
    findById.mockReset()
    findByEmail.mockReset()
    createRefreshToken.mockReset()
  })

  test('POST /invitations/decline は有効なPENDING招待を辞退して204を返す', async () => {
    findByToken.mockResolvedValue(pendingInvitation)
    decline.mockResolvedValue(true)

    const response = await app.request('/invitations/decline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN }),
    })

    expect(response.status).toBe(204)
    expect(decline).toHaveBeenCalledWith(1)
  })

  test('POST /invitations/decline はbodyが不正なら400を返す', async () => {
    const response = await app.request('/invitations/decline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: '' }),
    })

    expect(response.status).toBe(400)
  })

  test('POST /invitations/decline はtokenフィールド欠如なら400を返す', async () => {
    const response = await app.request('/invitations/decline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(400)
  })

  test('POST /invitations/decline はトークンが存在しない場合は404を返す', async () => {
    findByToken.mockResolvedValue(null)

    const response = await app.request('/invitations/decline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'bad-token' }),
    })

    expect(response.status).toBe(404)
  })

  test('POST /invitations/decline はACCEPTED状態なら409を返す', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, status: 'ACCEPTED' })

    const response = await app.request('/invitations/decline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN }),
    })

    expect(response.status).toBe(409)
  })

  test('POST /invitations/decline はCANCELED状態なら409を返す', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, status: 'CANCELED' })

    const response = await app.request('/invitations/decline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN }),
    })

    expect(response.status).toBe(409)
  })

  test('POST /invitations/decline はDECLINED状態なら409を返す', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, status: 'DECLINED' })

    const response = await app.request('/invitations/decline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN }),
    })

    expect(response.status).toBe(409)
  })

  test('POST /invitations/decline はPENDINGでも期限切れの場合は遅延失効してから409を返す', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, expiresAt: pastDate })
    markExpired.mockResolvedValue(undefined)

    const response = await app.request('/invitations/decline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN }),
    })

    expect(response.status).toBe(409)
    expect(markExpired).toHaveBeenCalledWith(1)
  })

  test('POST /invitations/decline は認証なしでも204を返す（認証不要）', async () => {
    findByToken.mockResolvedValue(pendingInvitation)
    decline.mockResolvedValue(true)

    const response = await app.request('/invitations/decline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN }),
    })

    expect(response.status).toBe(204)
  })
})
