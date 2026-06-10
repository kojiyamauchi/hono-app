import { describe, expect, test } from 'bun:test'

import type { Membership } from '@/shared/membership/entities'

import { toMemberResponse } from '.'

const membership: Membership = {
  id: 1,
  userId: 2,
  organizationId: 3,
  role: 'MEMBER',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
}

describe('toMemberResponse', () => {
  test('メンバーシップをレスポンス用に変換する', () => {
    const result = toMemberResponse(membership)

    expect(result).toEqual({
      id: 1,
      userId: 2,
      organizationId: 3,
      role: 'MEMBER',
      createdAt: membership.createdAt,
    })
  })
})
