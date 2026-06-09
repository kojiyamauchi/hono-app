import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { sign } from 'hono/jwt'

import type { Membership, Role } from '@/shared/membership/entities'
import type { Organization } from '@/shared/organization/entities'

process.env.JWT_SECRET = 'test-secret'

const createWithOwner = mock()
const findByUserId = mock()
const findById = mock()
const update = mock()
const deleteById = mock()
const findByUserAndOrganization = mock()

await mock.module('@/shared/organization/repositories', () => ({
  organizationRepository: { createWithOwner, findByUserId, findById, update, deleteById },
}))
await mock.module('@/shared/membership/repositories', () => ({
  membershipRepository: { findByUserAndOrganization },
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
    createWithOwner.mockReset()
    findByUserId.mockReset()
    findById.mockReset()
    update.mockReset()
    deleteById.mockReset()
    findByUserAndOrganization.mockReset()
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

  test('DELETE /organizations/:id はOWNERなら204を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    deleteById.mockResolvedValue(undefined)
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
})
