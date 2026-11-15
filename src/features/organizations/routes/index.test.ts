import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { sign } from 'hono/jwt'

import type { Membership, Role } from '@/shared/membership/entities'
import type { Organization } from '@/shared/organization/entities'

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
})
