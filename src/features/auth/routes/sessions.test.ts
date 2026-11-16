import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { sign } from 'hono/jwt'

import type { User } from '@/shared/user/entities'

process.env.JWT_SECRET = 'test-secret'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret'
process.env.PASSWORD_RESET_TOKEN_SECRET = 'test-password-reset-secret'
process.env.EMAIL_VERIFICATION_TOKEN_SECRET = 'test-email-verification-secret'
process.env.ALLOWED_ORIGINS = 'http://localhost:3000'

const create = mock()
const findByTokenHash = mock()
const revokeById = mock()
const revokeFamily = mock()
const rotate = mock()
const revokeAllByUserId = mock()
const revokeByUserIdAndFamilyId = mock()
const changePassword = mock()
const findActiveSessionsByUserId = mock()

const prtCreate = mock()
const prtFindByTokenHash = mock()
const prtDeleteById = mock()
const prtConfirm = mock()
const evtFindByTokenHash = mock()
const evtConfirm = mock()

const findByEmail = mock()
const findById = mock()
const existsById = mock()
const createUser = mock()

await mock.module('@/shared/auth/repositories/credential', () => ({
  authCredentialRepository: { changePassword },
}))

await mock.module('@/shared/auth/repositories/refreshToken', () => ({
  refreshTokenRepository: {
    create,
    findByTokenHash,
    revokeById,
    revokeFamily,
    rotate,
    revokeAllByUserId,
    revokeByUserIdAndFamilyId,
    findActiveSessionsByUserId,
  },
}))

await mock.module('@/shared/auth/repositories/passwordReset', () => ({
  passwordResetTokenRepository: {
    create: prtCreate,
    findByTokenHash: prtFindByTokenHash,
    deleteById: prtDeleteById,
    confirm: prtConfirm,
  },
}))

await mock.module('@/shared/auth/repositories/emailVerification', () => ({
  emailVerificationTokenRepository: {
    findByTokenHash: evtFindByTokenHash,
    confirm: evtConfirm,
  },
}))
await mock.module('@/shared/user/repositories', () => ({
  userRepository: { findByEmail, findById, existsById, create: createUser },
}))

// notifierをモックしてno-op実装を差し替える
const notifierSend = mock()
const sendEmailVerificationBestEffort = mock()
const emailVerificationModule = await import('@/shared/auth/services/emailVerification')
await mock.module('@/shared/auth/services/emailVerification', () => ({
  ...emailVerificationModule,
  sendEmailVerificationBestEffort,
}))
const passwordResetModule = await import('@/shared/auth/services/passwordReset')
await mock.module('@/shared/auth/services/passwordReset', () => ({
  ...passwordResetModule,
  passwordResetNotifier: { send: notifierSend },
}))

const passwordResetRequestDelayMs = mock(() => 0)
await mock.module('@/utils/timing', () => ({
  passwordResetRequestDelayMs,
}))

const { app } = await import('@/app')

const user: User = {
  id: 1,
  name: 'Taro',
  email: 'taro@example.com',
  password: 'hashed',
  emailVerifiedAt: null,
  createdAt: new Date('2026-06-18T00:00:00.000Z'),
  updatedAt: new Date('2026-06-18T00:00:00.000Z'),
}

beforeEach(() => {
  existsById.mockReset()
  existsById.mockResolvedValue(true)
  create.mockReset()
  findByTokenHash.mockReset()
  revokeById.mockReset()
  revokeFamily.mockReset()
  rotate.mockReset()
  revokeAllByUserId.mockReset()
  revokeByUserIdAndFamilyId.mockReset()
  changePassword.mockReset()
  findActiveSessionsByUserId.mockReset()
  prtCreate.mockReset()
  prtFindByTokenHash.mockReset()
  prtDeleteById.mockReset()
  prtConfirm.mockReset()
  evtFindByTokenHash.mockReset()
  evtConfirm.mockReset()
  findByEmail.mockReset()
  findById.mockReset()
  createUser.mockReset()
  notifierSend.mockReset()
  sendEmailVerificationBestEffort.mockReset()
  passwordResetRequestDelayMs.mockReset()
  passwordResetRequestDelayMs.mockImplementation(() => 0)
})

const createAccessToken = async (userId: number): Promise<string> => {
  return sign({ sub: userId, exp: Math.floor(Date.now() / 1000) + 60 }, 'test-secret')
}

describe('GET /auth/sessions', () => {
  test('認証済みなら200を返し、{ sessions: [...] }を返すこと', async () => {
    const token = await createAccessToken(1)
    findById.mockResolvedValue(user)
    const createdAt = new Date('2026-06-01T00:00:00.000Z')
    const expiresAt = new Date('2026-07-01T00:00:00.000Z')
    const lastUsedAt = new Date('2026-06-20T00:00:00.000Z')
    findActiveSessionsByUserId.mockResolvedValue([{ familyId: 'family-uuid-1', createdAt, expiresAt, lastUsedAt }])

    const response = await app.request('/auth/sessions', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { sessions?: Array<{ id?: string; createdAt?: string; expiresAt?: string; lastUsedAt?: string }> }
    expect(Array.isArray(body.sessions)).toBe(true)
    expect(body.sessions).toHaveLength(1)
    // 各セッションにid/createdAt/expiresAt/lastUsedAtが含まれること
    const session = body.sessions?.[0]
    expect(session?.id).toBe('family-uuid-1')
    expect(session?.createdAt).toBeDefined()
    expect(session?.expiresAt).toBeDefined()
    expect(session?.lastUsedAt).toBeDefined()
  })

  test('レスポンスにtokenHashやrefreshToken値などの内部値を含まないこと', async () => {
    const token = await createAccessToken(1)
    findById.mockResolvedValue(user)
    findActiveSessionsByUserId.mockResolvedValue([
      {
        familyId: 'family-uuid-1',
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        expiresAt: new Date('2026-07-01T00:00:00.000Z'),
        lastUsedAt: new Date('2026-06-20T00:00:00.000Z'),
      },
    ])

    const response = await app.request('/auth/sessions', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(200)
    const bodyText = await response.text()
    expect(bodyText).not.toContain('tokenHash')
    expect(bodyText).not.toContain('familyId')
    expect(bodyText).not.toContain('revokedAt')
  })

  test('未認証なら401を返し、findActiveSessionsByUserIdが呼ばれないこと', async () => {
    const response = await app.request('/auth/sessions', { method: 'GET' })

    expect(response.status).toBe(401)
    expect(findActiveSessionsByUserId).not.toHaveBeenCalled()
  })
})

describe('DELETE /auth/sessions/:id', () => {
  const sessionId = '550e8400-e29b-41d4-a716-446655440000'

  test('認証済みかつ有効なUUIDなら指定セッションを失効して204を返す', async () => {
    const token = await createAccessToken(1)
    findById.mockResolvedValue(user)
    revokeByUserIdAndFamilyId.mockResolvedValue(1)

    const response = await app.request(`/auth/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(revokeByUserIdAndFamilyId).toHaveBeenCalledWith(1, sessionId)
  })

  test('未認証なら401を返し、失効処理を呼ばない', async () => {
    const response = await app.request(`/auth/sessions/${sessionId}`, { method: 'DELETE' })

    expect(response.status).toBe(401)
    expect(revokeByUserIdAndFamilyId).not.toHaveBeenCalled()
  })

  test('不正なidなら400を返す', async () => {
    const token = await createAccessToken(1)
    findById.mockResolvedValue(user)

    const response = await app.request('/auth/sessions/not-a-uuid', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(400)
    expect(revokeByUserIdAndFamilyId).not.toHaveBeenCalled()
  })

  test('存在しない・他ユーザー・失効済みのidなら404を返す', async () => {
    const token = await createAccessToken(1)
    findById.mockResolvedValue(user)
    revokeByUserIdAndFamilyId.mockResolvedValue(0)

    const response = await app.request(`/auth/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(404)
  })

  test('Originが許可リストに一致しない場合に403を返す', async () => {
    const token = await createAccessToken(1)

    const response = await app.request(`/auth/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: 'http://evil.com',
      },
    })

    expect(response.status).toBe(403)
    expect(revokeByUserIdAndFamilyId).not.toHaveBeenCalled()
  })
})
