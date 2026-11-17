import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { sign } from 'hono/jwt'

import type { Membership, Role } from '@/shared/membership/entities'

import { createRouteTestContext } from './testSupport'

const context = await createRouteTestContext()
const { app } = context
const { findByUserAndOrganization } = context.mocks.memberships
const { execute: transferOwnership } = context.mocks.transferOwnership

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

afterEach(() => {
  context.assertNoUnexpectedCalls()
})

afterAll(() => {
  context.cleanup()
})

describe('organizations transfer-ownership routes', () => {
  beforeEach(() => {
    context.reset()
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
