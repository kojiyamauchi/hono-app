import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { sign } from 'hono/jwt'

import type { Invitation, InvitationWithOrganization } from '@/shared/invitation/entities'
import type { Membership } from '@/shared/membership/entities'
import type { User } from '@/shared/user/entities'

process.env.JWT_SECRET = 'test-secret'

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

await mock.module('@/shared/invitation/repositories', () => ({
  invitationRepository: { findByToken, findByTokenWithOrganization, markExpired, accept, decline, signup },
}))
await mock.module('@/shared/membership/repositories', () => ({
  membershipRepository: { findByUserAndOrganization },
}))
await mock.module('@/shared/user/repositories', () => ({
  userRepository: { findById, findByEmail },
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

describe('invitations routes', () => {
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

  test('POST /invitations/accept は有効な招待を受諾して201とMemberResponseを返す', async () => {
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

  test('POST /invitations/signup は有効な招待で新規登録して201とAuthResultを返す', async () => {
    findByToken.mockResolvedValue(pendingInvitation)
    findByEmail.mockResolvedValue(null)
    signup.mockImplementation(
      async (_invitationId: number, _organizationId: number, email: string, name: string, password: string): Promise<User> => ({
        id: 20,
        name,
        email,
        password,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    )

    const response = await app.request('/invitations/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN, name: 'New Invitee', password: 'password123' }),
    })

    expect(response.status).toBe(201)
    const body = (await response.json()) as { token?: string; user?: { id?: number; email?: string; password?: string } }
    expect(typeof body.token).toBe('string')
    expect(body.user?.id).toBe(20)
    expect(body.user?.email).toBe('invitee@example.com')
    expect(body.user).not.toHaveProperty('password')
  })

  test('POST /invitations/signup は認証なしでも201を返す（認証不要）', async () => {
    findByToken.mockResolvedValue(pendingInvitation)
    findByEmail.mockResolvedValue(null)
    signup.mockResolvedValue({
      id: 20,
      name: 'New Invitee',
      email: 'invitee@example.com',
      password: 'hashed',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    const response = await app.request('/invitations/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN, name: 'New Invitee', password: 'password123' }),
    })

    expect(response.status).toBe(201)
  })

  test('POST /invitations/signup はbodyが不正なら400を返す', async () => {
    const response = await app.request('/invitations/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN, name: 'New Invitee', password: 'short' }),
    })

    expect(response.status).toBe(400)
  })

  test('POST /invitations/signup は必須フィールド欠如なら400を返す', async () => {
    const response = await app.request('/invitations/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN, password: 'password123' }),
    })

    expect(response.status).toBe(400)
  })

  test('POST /invitations/signup はトークンが存在しない場合は404を返す', async () => {
    findByToken.mockResolvedValue(null)

    const response = await app.request('/invitations/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'bad-token', name: 'New Invitee', password: 'password123' }),
    })

    expect(response.status).toBe(404)
  })

  test('POST /invitations/signup はACCEPTED状態なら409を返す', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, status: 'ACCEPTED' })

    const response = await app.request('/invitations/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN, name: 'New Invitee', password: 'password123' }),
    })

    expect(response.status).toBe(409)
  })

  test('POST /invitations/signup はDECLINED状態なら409を返す', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, status: 'DECLINED' })

    const response = await app.request('/invitations/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN, name: 'New Invitee', password: 'password123' }),
    })

    expect(response.status).toBe(409)
  })

  test('POST /invitations/signup はPENDINGでも期限切れの場合は遅延失効してから409を返す', async () => {
    findByToken.mockResolvedValue({ ...pendingInvitation, expiresAt: pastDate })
    markExpired.mockResolvedValue(undefined)

    const response = await app.request('/invitations/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN, name: 'New Invitee', password: 'password123' }),
    })

    expect(response.status).toBe(409)
    expect(markExpired).toHaveBeenCalledWith(1)
  })

  test('POST /invitations/signup は招待メールのユーザーが既に存在する場合は409を返す', async () => {
    findByToken.mockResolvedValue(pendingInvitation)
    findByEmail.mockResolvedValue(inviteeUser)

    const response = await app.request('/invitations/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN, name: 'New Invitee', password: 'password123' }),
    })

    expect(response.status).toBe(409)
  })

  test('POST /invitations/signup は競合で登録できなかった場合は409を返す', async () => {
    findByToken.mockResolvedValue(pendingInvitation)
    findByEmail.mockResolvedValue(null)
    signup.mockResolvedValue(null)

    const response = await app.request('/invitations/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN, name: 'New Invitee', password: 'password123' }),
    })

    expect(response.status).toBe(409)
  })

  test('GET /invitations/:token は認証なしで200とInvitationDetailResponseを返す', async () => {
    findByTokenWithOrganization.mockResolvedValue(pendingInvitationWithOrg)

    const response = await app.request(`/invitations/${TOKEN}`, { method: 'GET' })

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.id).toBe(1)
    expect(body.organization).toEqual({ id: 10, name: 'Example Organization' })
    expect(body.email).toBe('invitee@example.com')
    expect(body.role).toBe('MEMBER')
    expect(body.status).toBe('PENDING')
    // tokenをレスポンスに含めない
    expect(body.token).toBeUndefined()
    expect(body.invitationToken).toBeUndefined()
  })

  test('GET /invitations/:token はPENDINGかつ期限切れの場合にstatus=EXPIREDを返す（DBは更新しない）', async () => {
    const expiredWithOrg: InvitationWithOrganization = { ...pendingInvitationWithOrg, expiresAt: pastDate }
    findByTokenWithOrganization.mockResolvedValue(expiredWithOrg)

    const response = await app.request(`/invitations/${TOKEN}`, { method: 'GET' })

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.status).toBe('EXPIRED')
    expect(markExpired).not.toHaveBeenCalled()
  })

  test('GET /invitations/:token は存在しないトークンの場合は404を返す', async () => {
    findByTokenWithOrganization.mockResolvedValue(null)

    const response = await app.request('/invitations/bad-token', { method: 'GET' })

    expect(response.status).toBe(404)
  })

  test('GET /invitations/:token はACCEPTEDステータスの招待を200で返す', async () => {
    const acceptedWithOrg: InvitationWithOrganization = { ...pendingInvitationWithOrg, status: 'ACCEPTED' }
    findByTokenWithOrganization.mockResolvedValue(acceptedWithOrg)

    const response = await app.request(`/invitations/${TOKEN}`, { method: 'GET' })

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.status).toBe('ACCEPTED')
  })

  test('GET /invitations/:token はCANCELEDステータスの招待を200で返す', async () => {
    const canceledWithOrg: InvitationWithOrganization = { ...pendingInvitationWithOrg, status: 'CANCELED' }
    findByTokenWithOrganization.mockResolvedValue(canceledWithOrg)

    const response = await app.request(`/invitations/${TOKEN}`, { method: 'GET' })

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.status).toBe('CANCELED')
  })

  test('GET /invitations/:token はDECLINEDステータスの招待を200で返す', async () => {
    const declinedWithOrg: InvitationWithOrganization = { ...pendingInvitationWithOrg, status: 'DECLINED' }
    findByTokenWithOrganization.mockResolvedValue(declinedWithOrg)

    const response = await app.request(`/invitations/${TOKEN}`, { method: 'GET' })

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.status).toBe('DECLINED')
  })
})
