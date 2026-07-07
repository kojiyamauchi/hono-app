import { describe, expect, test } from 'bun:test'

import { invitationDetailDto, invitationDto } from '@/shared/invitation/dtos'
import type { Invitation } from '@/shared/invitation/entities'
import type { Organization } from '@/shared/organization/entities'

import { toInvitationDetailResponse, toInvitationResponse } from '.'

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

const organization: Organization = {
  id: 2,
  name: 'Test Organization',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
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
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
    })
  })

  test('tokenをinvitationTokenとして公開する', () => {
    const result = toInvitationResponse(invitation)

    expect(result.invitationToken).toBe('test-token-uuid')
    expect((result as Record<string, unknown>).token).toBeUndefined()
  })

  test('返却値がinvitationDto schemaに通る（DTO定義と実装の整合）', () => {
    const result = toInvitationResponse(invitation)

    expect(invitationDto.safeParse(result).success).toBe(true)
  })
})

describe('toInvitationDetailResponse', () => {
  test('招待と組織情報を詳細レスポンス用に変換する', () => {
    const result = toInvitationDetailResponse(invitation, organization)

    expect(result).toEqual({
      id: 1,
      organization: { id: 2, name: 'Test Organization' },
      email: 'user@example.com',
      role: 'MEMBER',
      status: 'PENDING',
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
    })
  })

  test('返却値がinvitationDetailDto schemaに通る（DTO定義と実装の整合）', () => {
    const result = toInvitationDetailResponse(invitation, organization)

    expect(invitationDetailDto.safeParse(result).success).toBe(true)
  })

  test('tokenをレスポンスに含めない', () => {
    const result = toInvitationDetailResponse(invitation, organization)

    expect((result as Record<string, unknown>).token).toBeUndefined()
    expect((result as Record<string, unknown>).invitationToken).toBeUndefined()
  })

  test('organizationIdをトップレベルに含めない', () => {
    const result = toInvitationDetailResponse(invitation, organization)

    expect((result as Record<string, unknown>).organizationId).toBeUndefined()
    expect(result.organization.id).toBe(2)
  })

  test('EXPIREDステータスを持つ招待を変換する', () => {
    const expiredInvitation: Invitation = { ...invitation, status: 'EXPIRED' }
    const result = toInvitationDetailResponse(expiredInvitation, organization)

    expect(result.status).toBe('EXPIRED')
  })

  test('ACCEPTEDステータスを持つ招待を変換する', () => {
    const acceptedInvitation: Invitation = { ...invitation, status: 'ACCEPTED' }
    const result = toInvitationDetailResponse(acceptedInvitation, organization)

    expect(result.status).toBe('ACCEPTED')
  })

  test('organizationのidとnameのみを使い、createdAtなどは含めない', () => {
    const result = toInvitationDetailResponse(invitation, organization)

    expect((result.organization as Record<string, unknown>).createdAt).toBeUndefined()
    expect((result.organization as Record<string, unknown>).updatedAt).toBeUndefined()
  })
})
