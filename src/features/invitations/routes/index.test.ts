import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { Invitation, InvitationWithOrganization } from '@/shared/invitation/entities'

import { createRouteTestContext } from './testSupport'

const context = await createRouteTestContext()
const { app } = context
const { findByTokenWithOrganization, markExpired } = context.mocks.invitations

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

/**
 * JWTトークンを生成する。
 */

afterEach(() => {
  context.assertNoUnexpectedCalls()
})

afterAll(() => {
  context.cleanup()
})

describe('invitations routes', () => {
  beforeEach(() => {
    context.reset()
  })

  test('GET /invitations/:token は認証なしで200とInvitationDetailDtoTypeを返す', async () => {
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
