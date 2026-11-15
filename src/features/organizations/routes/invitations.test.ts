import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { sign } from 'hono/jwt'

import type { Invitation } from '@/shared/invitation/entities'
import type { Membership, Role } from '@/shared/membership/entities'

process.env.JWT_SECRET = 'test-secret'

const createWithOwner = mock()
const findPageByUserId = mock()
const findById = mock()
const update = mock()
const deleteById = mock()

const findByUserAndOrganization = mock()
const findPageByOrganization = mock()
const membershipFindById = mock()
const membershipCreate = mock()
const membershipDeleteById = mock()

const findByEmail = mock()
const existsById = mock()

const invitationFindPendingByOrgAndEmail = mock()
const invitationCreate = mock()
const invitationFindAllByOrganization = mock()
const invitationFindById = mock()
const invitationCancel = mock()
const requestResend = mock()

const transferOwnership = mock()
const leaveOrganization = mock()
const changeRoleWithAuditLog = mock()
const findAuditLogPage = mock()
const removeWithAuditLog = mock()

await mock.module('@/features/organizations/repositories/members', () => ({
  membersRepository: { remove: removeWithAuditLog, leave: leaveOrganization, changeRole: changeRoleWithAuditLog },
  memberRemovalResults: {
    removed: 'REMOVED',
    organizationNotFound: 'ORGANIZATION_NOT_FOUND',
    targetNotFound: 'TARGET_NOT_FOUND',
    rejected: 'REJECTED',
  },
  memberRoleChangeResults: {
    changed: 'CHANGED',
    unchanged: 'UNCHANGED',
    organizationNotFound: 'ORGANIZATION_NOT_FOUND',
    targetNotFound: 'TARGET_NOT_FOUND',
    rejected: 'REJECTED',
    conflict: 'CONFLICT',
  },
  leaveOrganizationResults: {
    left: 'LEFT',
    owner: 'OWNER',
    notMember: 'NOT_MEMBER',
    conflict: 'CONFLICT',
  },
}))

await mock.module('@/features/organizations/repositories/transferOwnership', () => ({
  transferOwnershipRepository: { execute: transferOwnership },
  ownershipTransferResults: {
    transferred: 'TRANSFERRED',
    targetNotFound: 'TARGET_NOT_FOUND',
    selfTransfer: 'SELF_TRANSFER',
    conflict: 'CONFLICT',
  },
}))

await mock.module('@/features/organizations/repositories/auditLogs', () => ({
  auditLogsRepository: { findPage: findAuditLogPage },
}))

await mock.module('@/shared/organization/repositories', () => ({
  organizationRepository: { createWithOwner, findPageByUserId, findById, update, deleteById },
}))
await mock.module('@/shared/membership/repositories', () => ({
  membershipRepository: {
    findByUserAndOrganization,
    findPageByOrganization,
    findById: membershipFindById,
    create: membershipCreate,
    deleteById: membershipDeleteById,
  },
}))
await mock.module('@/shared/user/repositories', () => ({
  userRepository: { findByEmail, existsById },
}))
await mock.module('@/shared/invitation/repositories', () => ({
  invitationRepository: {
    findPendingByOrgAndEmail: invitationFindPendingByOrgAndEmail,
    create: invitationCreate,
    findAllByOrganization: invitationFindAllByOrganization,
    findById: invitationFindById,
    cancel: invitationCancel,
  },
}))

await mock.module('@/shared/invitation/repositories/emailResend', () => ({
  invitationEmailResendRepository: { requestResend },
  invitationEmailResendResults: { requested: 'REQUESTED', organizationNotFound: 'ORGANIZATION_NOT_FOUND', rejected: 'REJECTED' },
}))

const { app } = await import('@/app')

const membershipWithRole = (role: Role): Membership => ({
  id: 1,
  userId: 1,
  organizationId: 1,
  role,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
})

const createToken = async (userId: number): Promise<string> => {
  return sign({ sub: userId, exp: Math.floor(Date.now() / 1000) + 60 }, 'test-secret')
}

describe('organizations invitations routes', () => {
  beforeEach(() => {
    existsById.mockReset()
    existsById.mockResolvedValue(true)
    createWithOwner.mockReset()
    findPageByUserId.mockReset()
    findById.mockReset()
    update.mockReset()
    deleteById.mockReset()
    findByUserAndOrganization.mockReset()
    findPageByOrganization.mockReset()
    membershipFindById.mockReset()
    membershipCreate.mockReset()
    changeRoleWithAuditLog.mockReset()
    removeWithAuditLog.mockReset()
    findAuditLogPage.mockReset()
    membershipDeleteById.mockReset()
    findByEmail.mockReset()
    invitationFindPendingByOrgAndEmail.mockReset()
    invitationCreate.mockReset()
    invitationFindAllByOrganization.mockReset()
    invitationFindById.mockReset()
    invitationCancel.mockReset()
    requestResend.mockReset()
    transferOwnership.mockReset()
    leaveOrganization.mockReset()
  })

  test('GET /organizations/:id/invitations は不正なID形式なら400を返す', async () => {
    const token = await createToken(1)

    const response = await app.request('/organizations/not-number/invitations', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(400)
    expect(findByUserAndOrganization).not.toHaveBeenCalled()
  })

  test('DELETE /organizations/:id/invitations/:invitationId は不正なinvitationIdなら（非メンバーでも）400を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(null)
    const token = await createToken(1)

    const response = await app.request('/organizations/1/invitations/not-number', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(400)
    expect(findByUserAndOrganization).not.toHaveBeenCalled()
    expect(invitationCancel).not.toHaveBeenCalled()
  })

  const invitation: Invitation = {
    id: 20,
    organizationId: 1,
    email: 'invite@example.com',
    role: 'MEMBER',
    status: 'PENDING',
    token: 'uuid-token',
    expiresAt: new Date('2026-06-18T00:00:00.000Z'),
    createdAt: new Date('2026-06-11T00:00:00.000Z'),
  }

  test('GET /organizations/:id/invitations はOWNERなら200を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    invitationFindAllByOrganization.mockResolvedValue([{ ...invitation, emailDelivery: null }])
    const token = await createToken(1)

    const response = await app.request('/organizations/1/invitations', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as Array<{ invitationToken: string; emailDeliveryStatus: string | null }>
    expect(body).toHaveLength(1)
    expect(body[0]?.invitationToken).toBe('uuid-token')
    expect(body[0]?.emailDeliveryStatus).toBeNull()
  })

  test('GET /organizations/:id/invitations は既存項目を維持しemailDeliveryStatus(保存値/null)のみを追加して返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('ADMIN'))
    invitationFindAllByOrganization.mockResolvedValue([
      { ...invitation, id: 21, emailDelivery: { status: 'ACCEPTED', resendEmailId: 'resend-secret' } },
      { ...invitation, id: 20, emailDelivery: null },
    ])
    const token = await createToken(1)

    const response = await app.request('/organizations/1/invitations', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>[]
    expect(body.map((item) => item.id)).toEqual([21, 20])
    expect(body.map((item) => item.emailDeliveryStatus)).toEqual(['ACCEPTED', null])
    expect(Object.keys(body[0] ?? {}).sort()).toEqual(
      ['id', 'organizationId', 'email', 'role', 'status', 'invitationToken', 'expiresAt', 'createdAt', 'emailDeliveryStatus'].sort(),
    )
    expect(body[0]?.invitationToken).toBe('uuid-token')
    expect(JSON.stringify(body)).not.toContain('resend-secret')
  })

  test('GET /organizations/:id/invitations は招待が0件なら空配列を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    invitationFindAllByOrganization.mockResolvedValue([])
    const token = await createToken(1)

    const response = await app.request('/organizations/1/invitations', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
  })

  test('GET /organizations/:id/invitations はトークンがなければ401を返す', async () => {
    const response = await app.request('/organizations/1/invitations')

    expect(response.status).toBe(401)
    expect(invitationFindAllByOrganization).not.toHaveBeenCalled()
  })

  test('GET /organizations/:id/invitations はMEMBERなら403を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('MEMBER'))
    const token = await createToken(1)

    const response = await app.request('/organizations/1/invitations', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(403)
    expect(invitationFindAllByOrganization).not.toHaveBeenCalled()
  })

  test('GET /organizations/:id/invitations は非メンバーなら404を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(null)
    const token = await createToken(1)

    const response = await app.request('/organizations/1/invitations', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(404)
  })

  test('POST /organizations/:id/invitations はOWNERならMEMBER招待を作成できる', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    invitationFindPendingByOrgAndEmail.mockResolvedValue(null)
    findByEmail.mockResolvedValue(null)
    invitationCreate.mockResolvedValue(invitation)
    const token = await createToken(1)

    const response = await app.request('/organizations/1/invitations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invite@example.com', role: 'MEMBER' }),
    })

    expect(response.status).toBe(201)
    const body = (await response.json()) as { invitationToken?: string }
    expect(body.invitationToken).toBe('uuid-token')
  })

  test('POST /organizations/:id/invitations はOWNERロール指定で422を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    const token = await createToken(1)

    const response = await app.request('/organizations/1/invitations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invite@example.com', role: 'OWNER' }),
    })

    expect(response.status).toBe(422)
    expect(invitationCreate).not.toHaveBeenCalled()
  })

  test('POST /organizations/:id/invitations はADMINがADMIN招待を作成しようとすると403を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('ADMIN'))
    const token = await createToken(1)

    const response = await app.request('/organizations/1/invitations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invite@example.com', role: 'ADMIN' }),
    })

    expect(response.status).toBe(403)
    expect(invitationCreate).not.toHaveBeenCalled()
  })

  test('POST /organizations/:id/invitations はMEMBERなら403を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('MEMBER'))
    const token = await createToken(1)

    const response = await app.request('/organizations/1/invitations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invite@example.com', role: 'MEMBER' }),
    })

    expect(response.status).toBe(403)
    expect(invitationCreate).not.toHaveBeenCalled()
  })

  test('POST /organizations/:id/invitations はPENDING招待が既に存在すると409を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    invitationFindPendingByOrgAndEmail.mockResolvedValue(invitation)
    const token = await createToken(1)

    const response = await app.request('/organizations/1/invitations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invite@example.com', role: 'MEMBER' }),
    })

    expect(response.status).toBe(409)
    expect(invitationCreate).not.toHaveBeenCalled()
  })

  test('DELETE /organizations/:id/invitations/:invitationId はOWNERなら204を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    invitationFindById.mockResolvedValue(invitation)
    invitationCancel.mockResolvedValue(true)
    const token = await createToken(1)

    const response = await app.request('/organizations/1/invitations/20', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(204)
    expect(invitationCancel).toHaveBeenCalledWith(20)
  })

  test('DELETE /organizations/:id/invitations/:invitationId は招待が存在しなければ404を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    invitationFindById.mockResolvedValue(null)
    const token = await createToken(1)

    const response = await app.request('/organizations/1/invitations/999', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(404)
    expect(invitationCancel).not.toHaveBeenCalled()
  })

  test('DELETE /organizations/:id/invitations/:invitationId はPENDING以外なら409を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    invitationFindById.mockResolvedValue({ ...invitation, status: 'ACCEPTED' })
    const token = await createToken(1)

    const response = await app.request('/organizations/1/invitations/20', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(409)
    expect(invitationCancel).not.toHaveBeenCalled()
  })

  test('DELETE /organizations/:id/invitations/:invitationId はADMINがADMIN宛て招待をキャンセルしようとすると403を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('ADMIN'))
    invitationFindById.mockResolvedValue({ ...invitation, role: 'ADMIN' })
    const token = await createToken(1)

    const response = await app.request('/organizations/1/invitations/20', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(403)
    expect(invitationCancel).not.toHaveBeenCalled()
  })

  test('DELETE /organizations/:id/invitations/:invitationId はMEMBERなら403を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('MEMBER'))
    const token = await createToken(1)

    const response = await app.request('/organizations/1/invitations/20', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(403)
    expect(invitationCancel).not.toHaveBeenCalled()
  })

  // --- 招待メール再送 ---

  const resendEnv = {
    ENABLE_INVITATION_EMAIL: 'true',
    ENABLE_API_DOCS: 'true',
    RESEND_API_KEY: 're_test_key',
    INVITATION_EMAIL_FROM: 'noreply@example.com',
    INVITATION_EMAIL_SCALAR_URL: 'https://example.com/open-api/scalar',
  }

  /** 再送用の配信設定を環境変数へ設定して処理を実行し、終了後に元へ戻す。 */
  const withResendEnv = async (run: () => Promise<void>, overrides: Record<string, string | undefined> = {}): Promise<void> => {
    const merged: Record<string, string | undefined> = { ...resendEnv, ...overrides }
    const previous = Object.fromEntries(Object.keys(merged).map((key) => [key, process.env[key]]))
    for (const [key, value] of Object.entries(merged)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    try {
      await run()
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  }

  type ResendCallbacks = Record<'authorizeOperator' | 'authorizeTarget' | 'evaluate', (s: unknown) => unknown>

  /** repositoryがロック後の状態で段階ごとのコールバックを呼び、拒否で止まる動きを再現する。 */
  const mockLockedState = (state: Record<string, unknown> = {}): void => {
    requestResend.mockImplementation(async (_input: unknown, callbacks: ResendCallbacks) => {
      const locked = {
        operatorRole: 'OWNER',
        invitation: { role: 'MEMBER', status: 'PENDING', expiresAt: new Date(Date.now() + 60_000) } as unknown,
        delivery: { status: 'REJECTED', hasUnknownOutcome: false, lastError: 'client', manualResendRequestedAt: null },
        now: new Date(),
        ...state,
      }
      const rejected = (rejection: unknown): { status: string; rejection: unknown } => ({ status: 'REJECTED', rejection })
      const operator = callbacks.authorizeOperator({ operatorRole: locked.operatorRole })
      if (operator !== null) return rejected(operator)
      const target = callbacks.authorizeTarget({ operatorRole: locked.operatorRole, invitation: locked.invitation })
      if (target !== null) return rejected(target)
      const evaluation = callbacks.evaluate({ invitation: locked.invitation, delivery: locked.delivery, now: locked.now })
      return evaluation === null ? { status: 'REQUESTED' } : rejected(evaluation)
    })
  }

  const postResend = async (path = '/organizations/1/invitations/20/resend-email', userId = 1): Promise<Response> => {
    const token = await createToken(userId)
    return app.request(path, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
  }

  test('POST /organizations/:id/invitations/:invitationId/resend-email はOWNERなら本文なしの202を返す', async () => {
    mockLockedState()

    await withResendEnv(async () => {
      const response = await postResend()

      expect(response.status).toBe(202)
      expect(await response.text()).toBe('')
      expect(requestResend.mock.calls[0]?.[0]).toMatchObject({ organizationId: 1, invitationId: 20, actorUserId: 1 })
    })
  })

  test('POST resend-email は未認証なら401を返す', async () => {
    const response = await app.request('/organizations/1/invitations/20/resend-email', { method: 'POST' })

    expect(response.status).toBe(401)
    expect(requestResend).not.toHaveBeenCalled()
  })

  test('POST resend-email は不正なinvitationIdなら400を返す', async () => {
    const response = await postResend('/organizations/1/invitations/not-number/resend-email')

    expect(response.status).toBe(400)
    expect(requestResend).not.toHaveBeenCalled()
  })

  test('POST resend-email は非メンバー（repositoryが組織なしを返す）なら404を返し、membership middlewareを経由しない', async () => {
    requestResend.mockResolvedValue({ status: 'ORGANIZATION_NOT_FOUND' })

    const response = await postResend()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: { message: '組織が見つかりません' } })
    expect(findByUserAndOrganization).not.toHaveBeenCalled()
  })

  test('POST resend-email はロック後のロールがMEMBERなら403を返す', async () => {
    mockLockedState({ operatorRole: 'MEMBER' })

    const response = await postResend()

    expect(response.status).toBe(403)
    expect(findByUserAndOrganization).not.toHaveBeenCalled()
  })

  test('POST resend-email はOWNER宛ての招待ならOWNERでも403を返す', async () => {
    mockLockedState({ invitation: { role: 'OWNER', status: 'PENDING', expiresAt: new Date(Date.now() + 60_000) } })

    await withResendEnv(async () => {
      const response = await postResend()

      expect(response.status).toBe(403)
    })
  })

  test('POST resend-email は招待が存在しなければ404を返す', async () => {
    mockLockedState({ invitation: null, delivery: null })

    await withResendEnv(async () => {
      const response = await postResend()

      expect(response.status).toBe(404)
    })
  })

  test('POST resend-email はADMINがADMIN宛てを再送しようとすると403を返す', async () => {
    mockLockedState({ operatorRole: 'ADMIN', invitation: { role: 'ADMIN', status: 'PENDING', expiresAt: new Date(Date.now() + 60_000) } })

    await withResendEnv(async () => {
      const response = await postResend()

      expect(response.status).toBe(403)
    })
  })

  test('POST resend-email は再送受付済みなら専用メッセージの409を返す', async () => {
    mockLockedState({ delivery: { status: 'REJECTED', hasUnknownOutcome: false, lastError: 'client', manualResendRequestedAt: new Date() } })

    await withResendEnv(async () => {
      const response = await postResend()

      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({ error: { message: 'この招待メールの再送は既に受け付けています' } })
    })
  })

  test('POST resend-email は配信設定が無効なら409を返す', async () => {
    mockLockedState()

    await withResendEnv(
      async () => {
        const response = await postResend()

        expect(response.status).toBe(409)
      },
      { ENABLE_INVITATION_EMAIL: undefined },
    )
  })

  test('POST resend-email は配信設定の不備なら内部情報を含まない500を返す', async () => {
    mockLockedState()

    await withResendEnv(
      async () => {
        const response = await postResend()

        expect(response.status).toBe(500)
        expect(JSON.stringify(await response.json())).not.toContain('RESEND')
      },
      { RESEND_API_KEY: undefined },
    )
  })

  test('POST resend-email は再送対象外の配信なら409を返す', async () => {
    mockLockedState({ delivery: { status: 'REJECTED', hasUnknownOutcome: false, lastError: 'invalid_idempotency', manualResendRequestedAt: null } })

    await withResendEnv(async () => {
      const response = await postResend()

      expect(response.status).toBe(409)
    })
  })
})
