import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { Invitation } from '@/shared/invitation/entities'

import { createRouteTestContext } from './testSupport'

const context = await createRouteTestContext()
const { app } = context
const { findByToken, markExpired, decline } = context.mocks.invitations

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

afterEach(() => {
  context.assertNoUnexpectedCalls()
})

afterAll(() => {
  context.cleanup()
})

describe('invitations decline routes', () => {
  beforeEach(() => {
    context.reset()
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
