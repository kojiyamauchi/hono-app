import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { sign } from 'hono/jwt'

import type { AuditLog } from '@/features/organizations/entities'
import type { Invitation } from '@/shared/invitation/entities'
import type { Membership, Role } from '@/shared/membership/entities'
import type { Organization } from '@/shared/organization/entities'
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

const transferOwnership = mock()
const leaveOrganization = mock()
const changeRoleWithAuditLog = mock()
const findAuditLogPage = mock()

await mock.module('@/features/organizations/repositories', () => ({
  organizationMembershipRepository: { leave: leaveOrganization },
  organizationOwnershipRepository: { transferOwnership },
  organizationMemberRoleRepository: { changeRoleWithAuditLog },
  organizationAuditLogRepository: { findPageByOrganization: findAuditLogPage },
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
  ownershipTransferResults: {
    transferred: 'TRANSFERRED',
    targetNotFound: 'TARGET_NOT_FOUND',
    selfTransfer: 'SELF_TRANSFER',
    conflict: 'CONFLICT',
  },
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

const { app } = await import('@/app')

const organization: Organization = {
  id: 1,
  name: 'Acme',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
}

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

describe('organizations routes', () => {
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
    findAuditLogPage.mockReset()
    membershipDeleteById.mockReset()
    findByEmail.mockReset()
    invitationFindPendingByOrgAndEmail.mockReset()
    invitationCreate.mockReset()
    invitationFindAllByOrganization.mockReset()
    invitationFindById.mockReset()
    invitationCancel.mockReset()
    transferOwnership.mockReset()
    leaveOrganization.mockReset()
  })

  test('POST /organizations は組織を作成する', async () => {
    createWithOwner.mockResolvedValue(organization)
    const token = await createToken(1)

    const response = await app.request('/organizations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Acme' }),
    })

    expect(response.status).toBe(201)
    const body = (await response.json()) as { name?: string }
    expect(body.name).toBe('Acme')
  })

  test('GET /organizations は所属組織一覧をページ情報つきで返す', async () => {
    findPageByUserId.mockResolvedValue([organization])
    const token = await createToken(1)

    const response = await app.request('/organizations', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { items: unknown[]; limit: number; offset: number; hasNext: boolean }
    expect(body.items).toHaveLength(1)
    // query未指定でも既定のlimit・offsetで先頭ページを返す
    expect(body).toMatchObject({ limit: 20, offset: 0, hasNext: false })
    expect(findPageByUserId).toHaveBeenCalledWith(1, 21, 0)
  })

  test('GET /organizations はlimit・offsetをqueryから受け取る', async () => {
    findPageByUserId.mockResolvedValue([])
    const token = await createToken(1)

    const response = await app.request('/organizations?limit=5&offset=10', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(200)
    expect(findPageByUserId).toHaveBeenCalledWith(1, 6, 10)
  })

  test.each(['limit=0', 'offset=abc', 'cursor=abc', 'offset=', 'limit=', 'offset=%20'])('GET /organizations?%s は400を返す', async (query) => {
    const token = await createToken(1)

    const response = await app.request(`/organizations?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(400)
    const body = (await response.json()) as { error?: { message?: string } }
    expect(typeof body.error?.message).toBe('string')
    expect(findPageByUserId).not.toHaveBeenCalled()
  })

  // route.middleware は query検証より先に走るため、不正queryでも認証エラーが優先される。
  test('GET /organizations?limit=0 はトークンがなければ401を返す', async () => {
    const response = await app.request('/organizations?limit=0')

    expect(response.status).toBe(401)
  })

  test('GET /organizations/:id はメンバーなら200を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('MEMBER'))
    findById.mockResolvedValue(organization)
    const token = await createToken(1)

    const response = await app.request('/organizations/1', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(200)
  })

  test('GET /organizations/:id は非メンバーなら404を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(null)
    const token = await createToken(1)

    const response = await app.request('/organizations/1', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(404)
  })

  test('PATCH /organizations/:id はADMINなら更新できる', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('ADMIN'))
    update.mockResolvedValue({ ...organization, name: 'New Name' })
    const token = await createToken(1)

    const response = await app.request('/organizations/1', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Name' }),
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { name?: string }
    expect(body.name).toBe('New Name')
  })

  test('PATCH /organizations/:id はMEMBERなら403を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('MEMBER'))
    const token = await createToken(1)

    const response = await app.request('/organizations/1', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Name' }),
    })

    expect(response.status).toBe(403)
    expect(update).not.toHaveBeenCalled()
  })

  test('PATCH /organizations/:id は非メンバーなら（不正bodyでも）404を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(null)
    const token = await createToken(1)

    const response = await app.request('/organizations/1', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })

    expect(response.status).toBe(404)
    expect(update).not.toHaveBeenCalled()
  })

  test('DELETE /organizations/:id はOWNERなら204を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    deleteById.mockResolvedValue(true)
    const token = await createToken(1)

    const response = await app.request('/organizations/1', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(204)
    expect(deleteById).toHaveBeenCalledWith(1)
  })

  test('DELETE /organizations/:id はMEMBERなら403を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('MEMBER'))
    const token = await createToken(1)

    const response = await app.request('/organizations/1', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(403)
    expect(deleteById).not.toHaveBeenCalled()
  })

  test('POST /organizations/:id/transfer-ownership はOWNERなら204を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    transferOwnership.mockResolvedValue('TRANSFERRED')
    const token = await createToken(1)

    const response = await app.request('/organizations/1/transfer-ownership', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ membershipId: 10 }),
    })

    expect(response.status).toBe(204)
    expect(transferOwnership).toHaveBeenCalledWith(1, 1, 10)
  })

  test('POST /organizations/:id/transfer-ownership はOWNER以外なら403を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('ADMIN'))
    const token = await createToken(1)

    const response = await app.request('/organizations/1/transfer-ownership', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ membershipId: 10 }),
    })

    expect(response.status).toBe(403)
    expect(transferOwnership).not.toHaveBeenCalled()
  })

  test('POST /organizations/:id/transfer-ownership は移譲先が見つからなければ404を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    transferOwnership.mockResolvedValue('TARGET_NOT_FOUND')
    const token = await createToken(1)

    const response = await app.request('/organizations/1/transfer-ownership', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ membershipId: 999 }),
    })

    expect(response.status).toBe(404)
  })

  test('POST /organizations/:id/transfer-ownership は自分自身への移譲なら422を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    transferOwnership.mockResolvedValue('SELF_TRANSFER')
    const token = await createToken(1)

    const response = await app.request('/organizations/1/transfer-ownership', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ membershipId: 1 }),
    })

    expect(response.status).toBe(422)
  })

  test('POST /organizations/:id/transfer-ownership はロック後の競合なら409を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    transferOwnership.mockResolvedValue('CONFLICT')
    const token = await createToken(1)

    const response = await app.request('/organizations/1/transfer-ownership', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ membershipId: 10 }),
    })

    expect(response.status).toBe(409)
  })

  test('POST /organizations/:id/transfer-ownership は不正bodyなら400を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    const token = await createToken(1)

    const response = await app.request('/organizations/1/transfer-ownership', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ membershipId: 0 }),
    })

    expect(response.status).toBe(400)
    expect(transferOwnership).not.toHaveBeenCalled()
  })

  test('GET /organizations はトークンがなければ401を返す', async () => {
    const response = await app.request('/organizations')

    expect(response.status).toBe(401)
  })

  // route.middleware は param検証より先に走るため、不正IDが404へ退行しないことを確認する（挙動退行の回帰テスト）。
  test('GET /organizations/:id は不正なID形式なら（membership確認前に）400を返す', async () => {
    const token = await createToken(1)

    const response = await app.request('/organizations/not-number', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(400)
    // エラー形式 `{ error: { message } }` は移行前（param validator の 400）と不変。
    const body = (await response.json()) as { error?: { message?: string } }
    expect(typeof body.error?.message).toBe('string')
    // 不正IDはDBクエリへ到達しない
    expect(findByUserAndOrganization).not.toHaveBeenCalled()
  })

  test('GET /organizations/:id/members は不正なID形式なら（不正queryがあっても）400を返す', async () => {
    const token = await createToken(1)

    const response = await app.request('/organizations/not-number/members?limit=0', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(400)
    expect(findByUserAndOrganization).not.toHaveBeenCalled()
  })

  test('GET /organizations/:id/invitations は不正なID形式なら400を返す', async () => {
    const token = await createToken(1)

    const response = await app.request('/organizations/not-number/invitations', {
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
    expect(changeRoleWithAuditLog).not.toHaveBeenCalled()
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
    expect(membershipDeleteById).not.toHaveBeenCalled()
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

  // --- メンバー管理ルート ---

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
    changeRoleWithAuditLog.mockResolvedValue({ status: 'CHANGED', membership: targetMembership('ADMIN') })
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
    expect(changeRoleWithAuditLog).toHaveBeenCalledWith({ organizationId: 1, targetMembershipId: 10, actorUserId: 1, newRole: 'ADMIN' }, expect.any(Function))
  })

  test('PATCH /organizations/:id/members/:membershipId は同一ロールの指定でも200を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('ADMIN'))
    changeRoleWithAuditLog.mockResolvedValue({ status: 'UNCHANGED', membership: targetMembership('MEMBER') })
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
    changeRoleWithAuditLog.mockImplementation(async (_input: unknown, authorize: (state: { operatorRole: Role; targetRole: Role }) => unknown) => ({
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
    changeRoleWithAuditLog.mockResolvedValue({ status: 'TARGET_NOT_FOUND' })
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
    changeRoleWithAuditLog.mockResolvedValue({ status: 'CONFLICT' })
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
    expect(changeRoleWithAuditLog).not.toHaveBeenCalled()
  })

  test('PATCH /organizations/:id/members/:membershipId は監査ログの書き込みに失敗したら500を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    changeRoleWithAuditLog.mockRejectedValue(new Error('INSERT失敗'))
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
    expect(changeRoleWithAuditLog).not.toHaveBeenCalled()
  })

  test('DELETE /organizations/:id/members/:membershipId はOWNERならMEMBERを削除できる', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    membershipFindById.mockResolvedValue(targetMembership('MEMBER'))
    membershipDeleteById.mockResolvedValue(true)
    const token = await createToken(1)

    const response = await app.request('/organizations/1/members/10', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(204)
    expect(membershipDeleteById).toHaveBeenCalledWith(10)
  })

  test('DELETE /organizations/:id/members/:membershipId は対象がOWNERなら409を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    membershipFindById.mockResolvedValue(targetMembership('OWNER'))
    const token = await createToken(1)

    const response = await app.request('/organizations/1/members/10', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(409)
    expect(membershipDeleteById).not.toHaveBeenCalled()
  })

  test('DELETE /organizations/:id/members/:membershipId はADMINがADMINを削除しようとすると403を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('ADMIN'))
    membershipFindById.mockResolvedValue(targetMembership('ADMIN'))
    const token = await createToken(1)

    const response = await app.request('/organizations/1/members/10', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(403)
    expect(membershipDeleteById).not.toHaveBeenCalled()
  })

  test('DELETE /organizations/:id/members/me はMEMBERなら204を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('MEMBER'))
    leaveOrganization.mockResolvedValue('LEFT')
    const token = await createToken(1)

    const response = await app.request('/organizations/1/members/me', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(204)
    expect(leaveOrganization).toHaveBeenCalledWith(1, 1)
    expect(membershipFindById).not.toHaveBeenCalled()
  })

  test('DELETE /organizations/:id/members/me はADMINなら204を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('ADMIN'))
    leaveOrganization.mockResolvedValue('LEFT')
    const token = await createToken(1)

    const response = await app.request('/organizations/1/members/me', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(204)
  })

  test('DELETE /organizations/:id/members/me はOWNERなら409を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    leaveOrganization.mockResolvedValue('OWNER')
    const token = await createToken(1)

    const response = await app.request('/organizations/1/members/me', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(409)
    expect(leaveOrganization).toHaveBeenCalledWith(1, 1)
  })

  test('DELETE /organizations/:id/members/me は未所属なら404を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(null)
    const token = await createToken(1)

    const response = await app.request('/organizations/1/members/me', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(404)
    expect(leaveOrganization).not.toHaveBeenCalled()
  })

  test('脱退後は同じ組織のメンバー向けAPIへアクセスできない', async () => {
    findByUserAndOrganization.mockResolvedValueOnce(membershipWithRole('MEMBER')).mockResolvedValueOnce(null)
    leaveOrganization.mockResolvedValue('LEFT')
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

  // --- 監査ログルート ---

  const auditLog = (id: number, createdAt = '2026-01-01T00:00:00.000Z'): AuditLog => ({
    id,
    organizationId: 1,
    action: 'MEMBER_ROLE_CHANGED',
    actorUserId: 1,
    targetUserId: 2,
    targetMembershipId: 10,
    previousRole: 'MEMBER',
    newRole: 'ADMIN',
    createdAt: new Date(createdAt),
  })

  const auditLogsRequest = async (path: string, token?: string): Promise<Response> =>
    app.request(path, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)

  // 認証 → パス検証 → 所属確認 → ロール確認 → query検証の順
  test('GET /organizations/:id/audit-logs は未認証なら不正queryでも401を返す', async () => {
    const response = await auditLogsRequest('/organizations/1/audit-logs?limit=0')

    expect(response.status).toBe(401)
    expect(findByUserAndOrganization).not.toHaveBeenCalled()
    expect(findAuditLogPage).not.toHaveBeenCalled()
  })

  test('GET /organizations/:id/audit-logs は不正な組織IDなら（不正queryでも）400を返し所属確認へ進まない', async () => {
    const token = await createToken(1)

    const response = await auditLogsRequest('/organizations/not-number/audit-logs?limit=0', token)

    expect(response.status).toBe(400)
    expect(findByUserAndOrganization).not.toHaveBeenCalled()
    expect(findAuditLogPage).not.toHaveBeenCalled()
  })

  // PostgreSQL INTEGERの上限（2147483647）を超える組織IDは、DBの整数変換で500になるため所属確認の前に400にする
  test.each(['2147483648', '9007199254740991'])(
    'GET /organizations/%s/audit-logs は上限を超える組織IDなら400を返し所属確認へ進まない',
    async (organizationId) => {
      const token = await createToken(1)

      const response = await auditLogsRequest(`/organizations/${organizationId}/audit-logs`, token)

      expect(response.status).toBe(400)
      const body = (await response.json()) as { error?: { message?: string } }
      expect(body.error?.message).toContain('2147483647以下')
      expect(findByUserAndOrganization).not.toHaveBeenCalled()
      expect(findAuditLogPage).not.toHaveBeenCalled()
    },
  )

  test('GET /organizations/2147483647/audit-logs は上限ちょうどの組織IDならパス検証を通過して所属確認へ進む', async () => {
    findByUserAndOrganization.mockResolvedValue(null)
    const token = await createToken(1)

    const response = await auditLogsRequest('/organizations/2147483647/audit-logs', token)

    expect(response.status).toBe(404)
    expect(findByUserAndOrganization).toHaveBeenCalledWith(1, 2147483647)
    expect(findAuditLogPage).not.toHaveBeenCalled()
  })

  test('GET /organizations/:id/audit-logs は未所属・存在しない組織なら不正queryでも404を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(null)
    const token = await createToken(1)

    const response = await auditLogsRequest('/organizations/1/audit-logs?limit=0', token)

    expect(response.status).toBe(404)
    expect(findAuditLogPage).not.toHaveBeenCalled()
  })

  test.each(['', '?limit=0', '?cursor=invalid', '?offset=0'])(
    'GET /organizations/:id/audit-logs%s はMEMBERなら403を返しrepositoryを呼ばない',
    async (query) => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('MEMBER'))
      const token = await createToken(1)

      const response = await auditLogsRequest(`/organizations/1/audit-logs${query}`, token)

      expect(response.status).toBe(403)
      expect(findAuditLogPage).not.toHaveBeenCalled()
    },
  )

  test.each<Role>(['OWNER', 'ADMIN'])('GET /organizations/:id/audit-logs は%sなら200で記録を新しい順のDTOで返す', async (role) => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole(role))
    findAuditLogPage.mockResolvedValue([auditLog(2, '2026-01-02T00:00:00.000Z'), auditLog(1)])
    const token = await createToken(1)

    const response = await auditLogsRequest('/organizations/1/audit-logs', token)

    expect(response.status).toBe(200)
    const body = (await response.json()) as { items: Record<string, unknown>[]; nextCursor: string | null }
    expect(body.items.map((item) => item.id)).toEqual([2, 1])
    expect(body.items[0]).toEqual({
      id: 2,
      organizationId: 1,
      action: 'MEMBER_ROLE_CHANGED',
      actorUserId: 1,
      targetUserId: 2,
      targetMembershipId: 10,
      previousRole: 'MEMBER',
      newRole: 'ADMIN',
      createdAt: '2026-01-02T00:00:00.000Z',
    })
    expect(body.nextCursor).toBeNull()
    // 認可済みの組織IDで絞り込み、次ページ判定のためlimit + 1件を要求する
    expect(findAuditLogPage).toHaveBeenCalledWith(1, 21, null)
  })

  test('GET /organizations/:id/audit-logs は0件なら空のitemsとnextCursor: nullを返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    findAuditLogPage.mockResolvedValue([])
    const token = await createToken(1)

    const response = await auditLogsRequest('/organizations/1/audit-logs', token)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ items: [], nextCursor: null })
  })

  test('GET /organizations/:id/audit-logs は同一createdAtの複数件でも、nextCursorの境界で重複・欠落なく続きを取得できる', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    const sameCreatedAt = '2026-01-01T00:00:00.000Z'
    const token = await createToken(1)

    // 1ページ目: limit=2 に対して3件を返す（次ページあり）。同一createdAtで id の降順
    findAuditLogPage.mockResolvedValueOnce([auditLog(12, sameCreatedAt), auditLog(11, sameCreatedAt), auditLog(10, sameCreatedAt)])
    const first = await auditLogsRequest('/organizations/1/audit-logs?limit=2', token)
    const firstBody = (await first.json()) as { items: { id: number }[]; nextCursor: string | null }

    expect(first.status).toBe(200)
    expect(firstBody.items.map((item) => item.id)).toEqual([12, 11])
    expect(firstBody.nextCursor).not.toBeNull()

    // 2ページ目: 最後に返したitem(id 11)を境界にし、残り1件で最終ページ
    findAuditLogPage.mockResolvedValueOnce([auditLog(10, sameCreatedAt)])
    const second = await auditLogsRequest(`/organizations/1/audit-logs?limit=2&cursor=${firstBody.nextCursor}`, token)
    const secondBody = (await second.json()) as { items: { id: number }[]; nextCursor: string | null }

    expect(second.status).toBe(200)
    expect(findAuditLogPage).toHaveBeenLastCalledWith(1, 3, { createdAt: new Date(sameCreatedAt), id: 11 })
    expect(secondBody.items.map((item) => item.id)).toEqual([10])
    expect(secondBody.nextCursor).toBeNull()
  })

  const encodeCursorPayload = (payload: Record<string, unknown>): string => Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const validAuditCursorPayload = { kind: 'auditLogs', version: 1, organizationId: 1, createdAt: '2026-01-01T00:00:00.000Z', id: 3 }

  test.each([
    ['limit=0'],
    ['limit=101'],
    ['limit='],
    ['cursor='],
    ['cursor=invalid'],
    ['offset=0'],
    // 別組織で発行されたカーソル
    [`cursor=${encodeCursorPayload({ ...validAuditCursorPayload, organizationId: 2 })}`],
    // メンバー一覧のカーソル（kindなし）
    [`cursor=${encodeCursorPayload({ version: 1, organizationId: 1, createdAt: '2026-01-01T00:00:00.000Z', id: 3 })}`],
    // 別種別のカーソル
    [`cursor=${encodeCursorPayload({ ...validAuditCursorPayload, kind: 'members' })}`],
    // PostgreSQLで扱えない0年の日時
    [`cursor=${encodeCursorPayload({ ...validAuditCursorPayload, createdAt: '0000-01-01T00:00:00.000Z' })}`],
    // 有効なカーソルの末尾に不正な文字（`!`）を足した、正規のbase64urlではないカーソル
    [`cursor=${encodeCursorPayload(validAuditCursorPayload)}%21`],
    // PostgreSQL INTEGERの上限（2147483647）を超える境界idとカーソルの組織ID
    [`cursor=${encodeCursorPayload({ ...validAuditCursorPayload, id: 2147483648 })}`],
    [`cursor=${encodeCursorPayload({ ...validAuditCursorPayload, organizationId: 2147483648 })}`],
  ])('GET /organizations/:id/audit-logs?%s はOWNER/ADMINでも400を返しrepositoryを呼ばない', async (query) => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('ADMIN'))
    const token = await createToken(1)

    const response = await auditLogsRequest(`/organizations/1/audit-logs?${query}`, token)

    expect(response.status).toBe(400)
    const body = (await response.json()) as { error?: { message?: string } }
    expect(typeof body.error?.message).toBe('string')
    expect(findAuditLogPage).not.toHaveBeenCalled()
  })

  test('GET /organizations/:id/audit-logs は境界idが上限（2147483647）ちょうどのカーソルを有効として扱う', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('ADMIN'))
    findAuditLogPage.mockResolvedValue([])
    const token = await createToken(1)
    const cursor = encodeCursorPayload({ ...validAuditCursorPayload, id: 2147483647 })

    const response = await auditLogsRequest(`/organizations/1/audit-logs?cursor=${cursor}`, token)

    expect(response.status).toBe(200)
    expect(findAuditLogPage).toHaveBeenCalledWith(1, 21, { createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 2147483647 })
  })

  // --- 招待管理ルート ---

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
    invitationFindAllByOrganization.mockResolvedValue([invitation])
    const token = await createToken(1)

    const response = await app.request('/organizations/1/invitations', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as unknown[]
    expect(body).toHaveLength(1)
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
})
