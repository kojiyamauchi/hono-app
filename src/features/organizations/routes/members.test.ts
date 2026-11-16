import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { sign } from 'hono/jwt'

import type { Membership, Role } from '@/shared/membership/entities'
import type { User } from '@/shared/user/entities'

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
const leaveMember = mock()
const changeRole = mock()
const findAuditLogPage = mock()
const removeMember = mock()

await mock.module('@/features/organizations/repositories/members', () => ({
  membersRepository: { remove: removeMember, leave: leaveMember, changeRole: changeRole },
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

const targetMembership = (role: Role): Membership => ({
  id: 10,
  userId: 2,
  organizationId: 1,
  role,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
})

const user: User = {
  id: 2,
  name: 'Target User',
  email: 'target@example.com',
  password: 'hash',
  emailVerifiedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

const createToken = async (userId: number): Promise<string> => {
  return sign({ sub: userId, exp: Math.floor(Date.now() / 1000) + 60 }, 'test-secret')
}

describe('organizations members routes', () => {
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
    changeRole.mockReset()
    removeMember.mockReset()
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
    leaveMember.mockReset()
  })

  test('GET /organizations/:id/members は不正なID形式なら（不正queryがあっても）400を返す', async () => {
    const token = await createToken(1)

    const response = await app.request('/organizations/not-number/members?limit=0', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(400)
    expect(findByUserAndOrganization).not.toHaveBeenCalled()
  })

  // nested param（membershipId / invitationId）も membership確認より先に検証されること。
  // 非メンバー状態でも param検証が先に走るため、404ではなく400で止まりDBへ到達しない（挙動退行の回帰テスト）。
  test('PATCH /organizations/:id/members/:membershipId は不正なmembershipIdなら（非メンバーでも）400を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(null)
    const token = await createToken(1)

    const response = await app.request('/organizations/1/members/not-number', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'MEMBER' }),
    })

    expect(response.status).toBe(400)
    expect(findByUserAndOrganization).not.toHaveBeenCalled()
    expect(changeRole).not.toHaveBeenCalled()
  })

  test('DELETE /organizations/:id/members/:membershipId は不正なmembershipIdなら（非メンバーでも）400を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(null)
    const token = await createToken(1)

    const response = await app.request('/organizations/1/members/not-number', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(400)
    expect(findByUserAndOrganization).not.toHaveBeenCalled()
    expect(removeMember).not.toHaveBeenCalled()
  })

  test('GET /organizations/:id/members はMEMBERなら200を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('MEMBER'))
    findPageByOrganization.mockResolvedValue([targetMembership('MEMBER')])
    const token = await createToken(1)

    const response = await app.request('/organizations/1/members', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { items: unknown[]; nextCursor: string | null }
    expect(body.items).toHaveLength(1)
    expect(body.nextCursor).toBeNull()
    expect(findPageByOrganization).toHaveBeenCalledWith(1, 21, null)
  })

  test('GET /organizations/:id/members は次ページがあればnextCursorを返し、そのカーソルで続きを取得できる', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('MEMBER'))
    findPageByOrganization.mockResolvedValueOnce([targetMembership('MEMBER'), { ...targetMembership('MEMBER'), id: 11 }])
    const token = await createToken(1)

    const first = await app.request('/organizations/1/members?limit=1', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(first.status).toBe(200)
    const firstBody = (await first.json()) as { items: unknown[]; nextCursor: string | null }
    expect(firstBody.items).toHaveLength(1)
    expect(firstBody.nextCursor).not.toBeNull()

    findPageByOrganization.mockResolvedValueOnce([])
    const second = await app.request(`/organizations/1/members?limit=1&cursor=${firstBody.nextCursor}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(second.status).toBe(200)
    expect(findPageByOrganization).toHaveBeenLastCalledWith(1, 2, { createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 10 })
  })

  test('GET /organizations/:id/members は非メンバーなら404を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(null)
    const token = await createToken(1)

    const response = await app.request('/organizations/1/members', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(404)
  })

  // route.middleware は query検証より先に走るため、不正queryでも所属確認（404）が優先される。
  test('GET /organizations/:id/members?limit=0 は非メンバーなら404を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(null)
    const token = await createToken(1)

    const response = await app.request('/organizations/1/members?limit=0', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(404)
    expect(findPageByOrganization).not.toHaveBeenCalled()
  })

  // 0年の日時を含むカーソルはPostgreSQLへバインドできないため、DBへ到達する前に400で止める。
  const zeroYearCursor = Buffer.from(JSON.stringify({ version: 1, organizationId: 1, createdAt: '0000-01-01T00:00:00.000Z', id: 1 }), 'utf8').toString(
    'base64url',
  )

  test.each(['limit=0', 'cursor=invalid', 'offset=0', `cursor=${zeroYearCursor}`])(
    'GET /organizations/:id/members?%s は所属ユーザーなら400を返す',
    async (query) => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('MEMBER'))
      const token = await createToken(1)

      const response = await app.request(`/organizations/1/members?${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(response.status).toBe(400)
      const body = (await response.json()) as { error?: { message?: string } }
      expect(typeof body.error?.message).toBe('string')
      expect(findPageByOrganization).not.toHaveBeenCalled()
    },
  )

  test('POST /organizations/:id/members はOWNERならADMINを追加できる', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    findByEmail.mockResolvedValue(user)
    membershipFindById.mockResolvedValue(null)
    // findByUserAndOrganizationは2回呼ばれる（ミドルウェアと既存チェック）
    findByUserAndOrganization.mockResolvedValueOnce(membershipWithRole('OWNER')).mockResolvedValueOnce(null)
    membershipCreate.mockResolvedValue(targetMembership('ADMIN'))
    const token = await createToken(1)

    const response = await app.request('/organizations/1/members', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'target@example.com', role: 'ADMIN' }),
    })

    expect(response.status).toBe(201)
  })

  test('POST /organizations/:id/members はADMINがADMINを追加しようとすると403を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('ADMIN'))
    const token = await createToken(1)

    const response = await app.request('/organizations/1/members', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'target@example.com', role: 'ADMIN' }),
    })

    expect(response.status).toBe(403)
    expect(membershipCreate).not.toHaveBeenCalled()
  })

  test('POST /organizations/:id/members はOWNERロール指定で422を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    const token = await createToken(1)

    const response = await app.request('/organizations/1/members', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'target@example.com', role: 'OWNER' }),
    })

    expect(response.status).toBe(422)
    expect(membershipCreate).not.toHaveBeenCalled()
  })

  test('PATCH /organizations/:id/members/:membershipId はOWNERならロールを変更できる', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    changeRole.mockResolvedValue({ status: 'CHANGED', membership: targetMembership('ADMIN') })
    const token = await createToken(1)

    const response = await app.request('/organizations/1/members/10', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'ADMIN' }),
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { id?: number; role?: string }
    expect(body).toMatchObject({ id: 10, role: 'ADMIN' })
    // 認証済みユーザーID（トークンのsub）を操作者として渡す
    expect(changeRole).toHaveBeenCalledWith({ organizationId: 1, targetMembershipId: 10, actorUserId: 1, newRole: 'ADMIN' }, expect.any(Function))
  })

  test('PATCH /organizations/:id/members/:membershipId は同一ロールの指定でも200を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('ADMIN'))
    changeRole.mockResolvedValue({ status: 'UNCHANGED', membership: targetMembership('MEMBER') })
    const token = await createToken(1)

    const response = await app.request('/organizations/1/members/10', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'MEMBER' }),
    })

    expect(response.status).toBe(200)
  })

  test('PATCH /organizations/:id/members/:membershipId は対象がOWNERなら409を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    // repositoryがロック後に読み直したロールで認可コールバックを呼ぶ動きを再現する
    changeRole.mockImplementation(async (_input: unknown, authorize: (state: { operatorRole: Role; targetRole: Role }) => unknown) => ({
      status: 'REJECTED',
      rejection: authorize({ operatorRole: 'OWNER', targetRole: 'OWNER' }),
    }))
    const token = await createToken(1)

    const response = await app.request('/organizations/1/members/10', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'MEMBER' }),
    })

    expect(response.status).toBe(409)
  })

  test('PATCH /organizations/:id/members/:membershipId は対象が見つからなければ404を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    changeRole.mockResolvedValue({ status: 'TARGET_NOT_FOUND' })
    const token = await createToken(1)

    const response = await app.request('/organizations/1/members/999', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'MEMBER' }),
    })

    expect(response.status).toBe(404)
  })

  test('PATCH /organizations/:id/members/:membershipId は競合なら409を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    changeRole.mockResolvedValue({ status: 'CONFLICT' })
    const token = await createToken(1)

    const response = await app.request('/organizations/1/members/10', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'ADMIN' }),
    })

    expect(response.status).toBe(409)
  })

  test('PATCH /organizations/:id/members/:membershipId はMEMBERなら403を返しrepositoryを呼ばない', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('MEMBER'))
    const token = await createToken(1)

    const response = await app.request('/organizations/1/members/10', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'MEMBER' }),
    })

    expect(response.status).toBe(403)
    expect(changeRole).not.toHaveBeenCalled()
  })

  test('PATCH /organizations/:id/members/:membershipId は監査ログの書き込みに失敗したら500を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    changeRole.mockRejectedValue(new Error('INSERT失敗'))
    const token = await createToken(1)

    const response = await app.request('/organizations/1/members/10', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'ADMIN' }),
    })

    expect(response.status).toBe(500)
  })

  test('PATCH /organizations/:id/members/:membershipId はOWNERロール指定で422を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    const token = await createToken(1)

    const response = await app.request('/organizations/1/members/10', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'OWNER' }),
    })

    expect(response.status).toBe(422)
    expect(changeRole).not.toHaveBeenCalled()
  })

  /** repositoryがロック後に読み直したロールで認可コールバックを呼ぶ動きを再現する。 */
  const simulateRemovalRepository = (locked: { operatorRole: Role; targetRole: Role | null }): void => {
    removeMember.mockImplementation(async (_input: unknown, authorize: (state: typeof locked) => unknown) => {
      const rejection = authorize(locked)
      if (rejection !== null) {
        return { status: 'REJECTED', rejection }
      }
      return locked.targetRole === null ? { status: 'TARGET_NOT_FOUND' } : { status: 'REMOVED' }
    })
  }

  const deleteMemberRequest = async (token: string, membershipId = 10): Promise<Response> =>
    app.request(`/organizations/1/members/${membershipId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })

  test.each([
    { name: 'OWNERがADMINを削除', operatorRole: 'OWNER', targetRole: 'ADMIN' },
    { name: 'OWNERがMEMBERを削除', operatorRole: 'OWNER', targetRole: 'MEMBER' },
    { name: 'ADMINがMEMBERを削除', operatorRole: 'ADMIN', targetRole: 'MEMBER' },
  ] as const)(
    'DELETE /organizations/:id/members/:membershipId は$name: 204を返し認証済みユーザーIDを操作者として渡す',
    async ({ operatorRole, targetRole }) => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole(operatorRole))
      simulateRemovalRepository({ operatorRole, targetRole })
      const token = await createToken(1)

      const response = await deleteMemberRequest(token)

      expect(response.status).toBe(204)
      expect(removeMember).toHaveBeenCalledWith({ organizationId: 1, targetMembershipId: 10, actorUserId: 1 }, expect.any(Function))
    },
  )

  test.each([
    { name: '対象がOWNERなら409', locked: { operatorRole: 'OWNER', targetRole: 'OWNER' }, status: 409 },
    { name: 'ADMINがADMINを削除しようとすると403', locked: { operatorRole: 'ADMIN', targetRole: 'ADMIN' }, status: 403 },
    { name: '対象が存在しなければ404', locked: { operatorRole: 'OWNER', targetRole: null }, status: 404 },
  ] as const)('DELETE /organizations/:id/members/:membershipId は$name', async ({ locked, status }) => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    simulateRemovalRepository(locked)
    const token = await createToken(1)

    const response = await deleteMemberRequest(token)

    expect(response.status).toBe(status)
  })

  test('DELETE /organizations/:id/members/:membershipId はmiddlewareのロールが古くても、ロック後のロールで403にする', async () => {
    // middlewareはOWNERと読んだが、ロック時点では既にMEMBERへ降格されている
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    simulateRemovalRepository({ operatorRole: 'MEMBER', targetRole: 'MEMBER' })
    const token = await createToken(1)

    const response = await deleteMemberRequest(token)

    expect(response.status).toBe(403)
  })

  test('DELETE /organizations/:id/members/:membershipId は監査ログの書き込みに失敗したら500を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    removeMember.mockRejectedValue(new Error('INSERT失敗'))
    const token = await createToken(1)

    const response = await deleteMemberRequest(token)

    expect(response.status).toBe(500)
  })

  test('DELETE /organizations/:id/members/:membershipId は未所属なら404を返しrepositoryを呼ばない', async () => {
    findByUserAndOrganization.mockResolvedValue(null)
    const token = await createToken(1)

    const response = await deleteMemberRequest(token)

    expect(response.status).toBe(404)
    expect(removeMember).not.toHaveBeenCalled()
  })

  test('DELETE /organizations/:id/members/me はMEMBERなら204を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('MEMBER'))
    leaveMember.mockResolvedValue('LEFT')
    const token = await createToken(1)

    const response = await app.request('/organizations/1/members/me', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(204)
    expect(leaveMember).toHaveBeenCalledWith(1, 1)
    expect(membershipFindById).not.toHaveBeenCalled()
  })

  // 静的パス `/members/me` が動的パス `/members/{membershipId}` より先に解決され、membershipIdの検証（400）や削除処理へ進まないことを確認する。
  test('DELETE /organizations/:id/members/me は members/:membershipId として検証・削除されず、脱退処理へ到達する', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('MEMBER'))
    leaveMember.mockResolvedValue('LEFT')
    const token = await createToken(1)

    const response = await app.request('/organizations/1/members/me', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(204)
    expect(leaveMember).toHaveBeenCalledTimes(1)
    expect(removeMember).not.toHaveBeenCalled()
  })

  test('DELETE /organizations/:id/members/me はADMINなら204を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('ADMIN'))
    leaveMember.mockResolvedValue('LEFT')
    const token = await createToken(1)

    const response = await app.request('/organizations/1/members/me', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(204)
  })

  test('DELETE /organizations/:id/members/me はOWNERなら409を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    leaveMember.mockResolvedValue('OWNER')
    const token = await createToken(1)

    const response = await app.request('/organizations/1/members/me', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(409)
    expect(leaveMember).toHaveBeenCalledWith(1, 1)
  })

  test('DELETE /organizations/:id/members/me は未所属なら404を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(null)
    const token = await createToken(1)

    const response = await app.request('/organizations/1/members/me', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(404)
    expect(leaveMember).not.toHaveBeenCalled()
  })

  test('脱退後は同じ組織のメンバー向けAPIへアクセスできない', async () => {
    findByUserAndOrganization.mockResolvedValueOnce(membershipWithRole('MEMBER')).mockResolvedValueOnce(null)
    leaveMember.mockResolvedValue('LEFT')
    const token = await createToken(1)

    const leaveResponse = await app.request('/organizations/1/members/me', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    const accessResponse = await app.request('/organizations/1/members', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(leaveResponse.status).toBe(204)
    expect(accessResponse.status).toBe(404)
  })
})
