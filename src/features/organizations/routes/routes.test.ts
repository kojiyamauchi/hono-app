import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { sign } from 'hono/jwt'

import type { Invitation } from '@/shared/invitation/entities'
import type { Membership, Role } from '@/shared/membership/entities'
import type { Organization } from '@/shared/organization/entities'
import type { User } from '@/shared/user/entities'

process.env.JWT_SECRET = 'test-secret'

const createWithOwner = mock()
const findByUserId = mock()
const findById = mock()
const update = mock()
const deleteById = mock()

const findByUserAndOrganization = mock()
const findAllByOrganization = mock()
const membershipFindById = mock()
const membershipCreate = mock()
const updateRole = mock()
const membershipDeleteById = mock()

const findByEmail = mock()

const invitationFindPendingByOrgAndEmail = mock()
const invitationCreate = mock()
const invitationFindAllByOrganization = mock()
const invitationFindById = mock()
const invitationCancel = mock()

await mock.module('@/shared/organization/repositories', () => ({
  organizationRepository: { createWithOwner, findByUserId, findById, update, deleteById },
}))
await mock.module('@/shared/membership/repositories', () => ({
  membershipRepository: {
    findByUserAndOrganization,
    findAllByOrganization,
    findById: membershipFindById,
    create: membershipCreate,
    updateRole,
    deleteById: membershipDeleteById,
  },
}))
await mock.module('@/shared/user/repositories', () => ({
  userRepository: { findByEmail },
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
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

const createToken = async (userId: number): Promise<string> => {
  return sign({ sub: userId, exp: Math.floor(Date.now() / 1000) + 60 }, 'test-secret')
}

describe('organizations routes', () => {
  beforeEach(() => {
    createWithOwner.mockReset()
    findByUserId.mockReset()
    findById.mockReset()
    update.mockReset()
    deleteById.mockReset()
    findByUserAndOrganization.mockReset()
    findAllByOrganization.mockReset()
    membershipFindById.mockReset()
    membershipCreate.mockReset()
    updateRole.mockReset()
    membershipDeleteById.mockReset()
    findByEmail.mockReset()
    invitationFindPendingByOrgAndEmail.mockReset()
    invitationCreate.mockReset()
    invitationFindAllByOrganization.mockReset()
    invitationFindById.mockReset()
    invitationCancel.mockReset()
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

  test('GET /organizations は所属組織一覧を返す', async () => {
    findByUserId.mockResolvedValue([organization])
    const token = await createToken(1)

    const response = await app.request('/organizations', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as unknown[]
    expect(body).toHaveLength(1)
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

  test('GET /organizations/:id/members は不正なID形式なら400を返す', async () => {
    const token = await createToken(1)

    const response = await app.request('/organizations/not-number/members', {
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

  // --- メンバー管理ルート ---

  test('GET /organizations/:id/members はMEMBERなら200を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('MEMBER'))
    findAllByOrganization.mockResolvedValue([targetMembership('MEMBER')])
    const token = await createToken(1)

    const response = await app.request('/organizations/1/members', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as unknown[]
    expect(body).toHaveLength(1)
  })

  test('GET /organizations/:id/members は非メンバーなら404を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(null)
    const token = await createToken(1)

    const response = await app.request('/organizations/1/members', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(404)
  })

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
    membershipFindById.mockResolvedValue(targetMembership('MEMBER'))
    updateRole.mockResolvedValue(targetMembership('ADMIN'))
    const token = await createToken(1)

    const response = await app.request('/organizations/1/members/10', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'ADMIN' }),
    })

    expect(response.status).toBe(200)
  })

  test('PATCH /organizations/:id/members/:membershipId は対象がOWNERなら409を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    membershipFindById.mockResolvedValue(targetMembership('OWNER'))
    const token = await createToken(1)

    const response = await app.request('/organizations/1/members/10', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'MEMBER' }),
    })

    expect(response.status).toBe(409)
    expect(updateRole).not.toHaveBeenCalled()
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
    expect(updateRole).not.toHaveBeenCalled()
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
