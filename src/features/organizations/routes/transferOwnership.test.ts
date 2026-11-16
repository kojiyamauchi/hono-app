import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { sign } from 'hono/jwt'

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

const createToken = async (userId: number): Promise<string> => {
  return sign({ sub: userId, exp: Math.floor(Date.now() / 1000) + 60 }, 'test-secret')
}

describe('organizations transfer-ownership routes', () => {
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

  test('POST /organizations/:id/transfer-ownership は監査ログの書き込みに失敗したら409へ変換せず500を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    transferOwnership.mockRejectedValue(new Error('INSERT失敗'))
    const token = await createToken(1)

    const response = await app.request('/organizations/1/transfer-ownership', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ membershipId: 10 }),
    })

    expect(response.status).toBe(500)
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
})
