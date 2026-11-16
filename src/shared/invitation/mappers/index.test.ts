import { describe, expect, test } from 'bun:test'

import { invitationDetailDto, invitationDto, invitationListItemDto } from '@/shared/invitation/dtos'
import type { Invitation, InvitationWithEmailDeliveryStatus } from '@/shared/invitation/entities'
import { invitationEmailDeliveryStatusValues } from '@/shared/invitation/entities/emailDelivery'
import type { Organization } from '@/shared/organization/entities'

import { toInvitationDetailResponse, toInvitationListItemResponse, toInvitationResponse } from '.'

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

describe('toInvitationListItemResponse', () => {
  for (const status of invitationEmailDeliveryStatusValues) {
    test(`配信状態${status}をemailDeliveryStatusへ写し、DTOとして妥当である`, () => {
      const result = toInvitationListItemResponse({ ...invitation, emailDelivery: { status } })

      expect(result).toEqual({ ...toInvitationResponse(invitation), emailDeliveryStatus: status })
      expect(invitationListItemDto.safeParse(result).success).toBe(true)
    })
  }

  test('配信レコードがない場合はemailDeliveryStatusがnullになる', () => {
    const result = toInvitationListItemResponse({ ...invitation, emailDelivery: null })

    expect(result.emailDeliveryStatus).toBeNull()
    expect(result.invitationToken).toBe('test-token-uuid')
    expect(invitationListItemDto.safeParse(result).success).toBe(true)
  })

  test('配信レコードの内部情報や余分なプロパティをレスポンスへ含めない', () => {
    const entity = {
      ...invitation,
      emailDelivery: { status: 'ACCEPTED', id: 'delivery-id', resendEmailId: 'resend-id', lastError: 'secret', attemptCount: 3, leaseToken: 'lease' },
    } as unknown as InvitationWithEmailDeliveryStatus

    const result = toInvitationListItemResponse(entity)

    expect(Object.keys(result).sort()).toEqual(
      ['id', 'organizationId', 'email', 'role', 'status', 'invitationToken', 'expiresAt', 'createdAt', 'emailDeliveryStatus'].sort(),
    )
    expect(JSON.stringify(result)).not.toContain('resend-id')
  })
})

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
