import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { Invitation } from '@/shared/invitation/entities'
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

/**
 * JWTトークンを生成する。
 */
describe('invitations signup routes', () => {
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

  test('POST /invitations/signup は有効な招待で新規登録して201とAuthResultDtoTypeを返し、Set-CookieヘッダーにリフレッシュトークンCookieをセットする', async () => {
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

    const response = await app.request('/invitations/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN, name: 'New Invitee', password: 'password123' }),
    })

    expect(response.status).toBe(201)
    const body = (await response.json()) as {
      token?: string
      refreshToken?: string
      user?: { id?: number; email?: string; emailVerified?: boolean; password?: string }
    }
    expect(typeof body.token).toBe('string')
    // bodyにrefreshTokenが含まれないことを確認する
    expect(body.refreshToken).toBeUndefined()
    expect(body.user?.id).toBe(20)
    expect(body.user?.email).toBe('invitee@example.com')
    expect(body.user?.emailVerified).toBe(false)
    expect(body.user).not.toHaveProperty('password')

    // リフレッシュトークンはCookieとして設定されることを確認する
    const setCookie = response.headers.get('set-cookie')
    expect(setCookie).not.toBeNull()
    expect(setCookie).toContain('refreshToken=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Path=/auth')
  })

  test('POST /invitations/signup は認証なしでも201を返す（認証不要）', async () => {
    findByToken.mockResolvedValue(pendingInvitation)
    findByEmail.mockResolvedValue(null)
    signup.mockResolvedValue({
      id: 20,
      name: 'New Invitee',
      email: 'invitee@example.com',
      password: 'hashed',
      emailVerifiedAt: null,
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

  test('POST /invitations/signup はOriginが許可リストに一致しない場合は403を返す', async () => {
    const response = await app.request('/invitations/signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://evil.com',
      },
      body: JSON.stringify({ token: TOKEN, name: 'New Invitee', password: 'password123' }),
    })

    expect(response.status).toBe(403)
  })

  test('POST /invitations/signup はOrigin=nullの場合は403を返す', async () => {
    const response = await app.request('/invitations/signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'null',
      },
      body: JSON.stringify({ token: TOKEN, name: 'New Invitee', password: 'password123' }),
    })

    expect(response.status).toBe(403)
  })
})
