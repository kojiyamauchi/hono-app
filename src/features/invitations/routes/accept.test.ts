import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { sign } from 'hono/jwt'

import type { Invitation } from '@/shared/invitation/entities'
import type { Membership } from '@/shared/membership/entities'
import type { User } from '@/shared/user/entities'

process.env.JWT_SECRET = 'test-secret'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret'
process.env.ALLOWED_ORIGINS = 'http://localhost:3000'

const createRefreshToken = mock()

await mock.module('@/shared/auth/repositories/credential', () => ({
  authCredentialRepository: {},
}))

await mock.module('@/shared/auth/repositories/refreshToken', () => ({
  refreshTokenRepository: { create: createRefreshToken },
}))

await mock.module('@/shared/auth/repositories/passwordReset', () => ({
  passwordResetTokenRepository: {},
}))

await mock.module('@/shared/auth/repositories/emailVerification', () => ({
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

/**
 * JWTトークンを生成する。
 */
const createToken = async (userId: number): Promise<string> => {
  return sign({ sub: userId, exp: Math.floor(Date.now() / 1000) + 60 }, 'test-secret')
}

describe('invitations accept routes', () => {
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

  test('POST /invitations/accept は有効な招待を受諾して201とMemberDtoTypeを返す', async () => {
    findByToken.mockResolvedValue(pendingInvitation)
    findById.mockResolvedValue(inviteeUser)
    findByUserAndOrganization.mockResolvedValue(null)
    accept.mockResolvedValue(createdMembership)
    const token = await createToken(5)

    const response = await app.request('/invitations/accept', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN }),
    })

    expect(response.status).toBe(201)
    const body = (await response.json()) as { userId?: number; organizationId?: number; role?: string }
    expect(body.userId).toBe(5)
    expect(body.organizationId).toBe(10)
    expect(body.role).toBe('MEMBER')
  })

  test('POST /invitations/accept は未認証なら401を返す', async () => {
    const response = await app.request('/invitations/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN }),
    })

    expect(response.status).toBe(401)
  })

  test('POST /invitations/accept はbodyが不正なら400を返す', async () => {
    const authToken = await createToken(5)

    const response = await app.request('/invitations/accept', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: '' }),
    })

    expect(response.status).toBe(400)
  })

  test('POST /invitations/accept はtokenフィールド欠如なら400を返す', async () => {
    const authToken = await createToken(5)

    const response = await app.request('/invitations/accept', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(400)
  })

  test('POST /invitations/accept はトークンが存在しない場合は404を返す', async () => {
    findByToken.mockResolvedValue(null)
    const authToken = await createToken(5)

    const response = await app.request('/invitations/accept', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'bad-token' }),
    })

    expect(response.status).toBe(404)
  })

  test('POST /invitations/accept はACCEPTED状態なら409を返す', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, status: 'ACCEPTED' })
    const authToken = await createToken(5)

    const response = await app.request('/invitations/accept', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN }),
    })

    expect(response.status).toBe(409)
  })

  test('POST /invitations/accept はPENDINGでも期限切れの場合は遅延失効してから409を返す', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, expiresAt: pastDate })
    markExpired.mockResolvedValue(undefined)
    const authToken = await createToken(5)

    const response = await app.request('/invitations/accept', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN }),
    })

    expect(response.status).toBe(409)
    expect(markExpired).toHaveBeenCalledWith(1)
  })

  test('POST /invitations/accept はメール不一致なら403を返す', async () => {
    const otherUser: User = { ...inviteeUser, email: 'other@example.com' }
    findByToken.mockResolvedValue(pendingInvitation)
    findById.mockResolvedValue(otherUser)
    const authToken = await createToken(5)

    const response = await app.request('/invitations/accept', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN }),
    })

    expect(response.status).toBe(403)
  })

  test('POST /invitations/accept は既にメンバーの場合は409を返す', async () => {
    findByToken.mockResolvedValue(pendingInvitation)
    findById.mockResolvedValue(inviteeUser)
    findByUserAndOrganization.mockResolvedValue(createdMembership)
    const authToken = await createToken(5)

    const response = await app.request('/invitations/accept', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN }),
    })

    expect(response.status).toBe(409)
  })
})
