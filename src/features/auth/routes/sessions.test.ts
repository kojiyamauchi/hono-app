import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { sign } from 'hono/jwt'

import { createRouteTestContext, createUserFixture } from './testSupport'

const context = await createRouteTestContext()
const { app } = context
const { revokeByUserIdAndFamilyId, findActiveSessionsByUserId } = context.mocks.refreshTokens
const { findById } = context.mocks.users
const user = createUserFixture()

beforeEach(() => {
  context.reset()
})

afterEach(() => {
  context.assertNoUnexpectedCalls()
})

afterAll(() => {
  context.cleanup()
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
