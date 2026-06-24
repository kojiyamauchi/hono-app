import { describe, expect, test } from 'bun:test'

import type { RefreshSession } from '@/shared/auth/entities'

import { toSessionResponse } from '.'

const createdAt = new Date('2026-06-01T00:00:00.000Z')
const expiresAt = new Date('2026-07-01T00:00:00.000Z')
const lastUsedAt = new Date('2026-06-20T00:00:00.000Z')

const session: RefreshSession = {
  familyId: 'family-uuid-1',
  createdAt,
  expiresAt,
  lastUsedAt,
}

describe('toSessionResponse', () => {
  test('RefreshSessionをSessionResponseへ変換し、idがfamilyIdになること', () => {
    const result = toSessionResponse(session)

    expect(result.id).toBe('family-uuid-1')
    expect(result.createdAt).toEqual(createdAt)
    expect(result.expiresAt).toEqual(expiresAt)
    expect(result.lastUsedAt).toEqual(lastUsedAt)
  })

  test('レスポンスのキーがid/createdAt/expiresAt/lastUsedAtの4つだけであること（内部値を含まない）', () => {
    const result = toSessionResponse(session)

    const keys = Object.keys(result)
    expect(keys).toHaveLength(4)
    expect(keys).toContain('id')
    expect(keys).toContain('createdAt')
    expect(keys).toContain('expiresAt')
    expect(keys).toContain('lastUsedAt')
  })

  test('tokenHashなどの内部プロパティを含まないこと', () => {
    const result = toSessionResponse(session)

    expect(result).not.toHaveProperty('tokenHash')
    expect(result).not.toHaveProperty('familyId')
    expect(result).not.toHaveProperty('revokedAt')
  })

  test('複数のセッションを変換してもidがそれぞれのfamilyIdになること', () => {
    const session2: RefreshSession = {
      familyId: 'family-uuid-2',
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
      expiresAt: new Date('2026-08-01T00:00:00.000Z'),
      lastUsedAt: new Date('2026-06-10T00:00:00.000Z'),
    }

    const result1 = toSessionResponse(session)
    const result2 = toSessionResponse(session2)

    expect(result1.id).toBe('family-uuid-1')
    expect(result2.id).toBe('family-uuid-2')
  })
})
