import { describe, expect, test } from 'bun:test'

import type { Invitation } from '@/shared/invitation/entities'

import { toInvitationResponse } from '.'

const invitation: Invitation = {
  id: 1,
  organizationId: 2,
  email: 'user@example.com',
  role: 'MEMBER',
  status: 'PENDING',
  token: 'test-token-uuid',
  expiresAt: new Date('2026-06-18T00:00:00.000Z'),
  createdAt: new Date('2026-06-11T00:00:00.000Z'),
}

describe('toInvitationResponse', () => {
  test('招待をレスポンス用に変換する', () => {
    const result = toInvitationResponse(invitation)

    expect(result).toEqual({
      id: 1,
      organizationId: 2,
      email: 'user@example.com',
      role: 'MEMBER',
      status: 'PENDING',
      invitationToken: 'test-token-uuid',
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    })
  })

  test('tokenをinvitationTokenとして公開する', () => {
    const result = toInvitationResponse(invitation)

    expect(result.invitationToken).toBe('test-token-uuid')
    expect((result as Record<string, unknown>).token).toBeUndefined()
  })
})
