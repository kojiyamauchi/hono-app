import { describe, expect, test } from 'bun:test'

import { calculateInvitationEmailDeadline, invitationEmailLimits, isManualResendEligibleDelivery } from './emailDelivery'

describe('calculateInvitationEmailDeadline', () => {
  const base = new Date('2026-01-01T00:00:00.000Z')

  test('招待の期限が遠い場合は基準時刻から6時間後を返す', () => {
    const result = calculateInvitationEmailDeadline(base, new Date('2026-01-08T00:00:00.000Z'))
    expect(result.getTime()).toBe(base.getTime() + invitationEmailLimits.maxAgeMs)
  })

  test('招待の期限が6時間以内の場合は招待の期限を返す', () => {
    const expiresAt = new Date('2026-01-01T01:00:00.000Z')
    expect(calculateInvitationEmailDeadline(base, expiresAt).getTime()).toBe(expiresAt.getTime())
  })
})

describe('isManualResendEligibleDelivery', () => {
  test.each(['client', 'rate_limited'])('REJECTEDで受付結果不明でなく %s なら対象', (lastError) => {
    expect(isManualResendEligibleDelivery({ status: 'REJECTED', hasUnknownOutcome: false, lastError })).toBe(true)
  })

  test('invalid_idempotencyは対象外', () => {
    expect(isManualResendEligibleDelivery({ status: 'REJECTED', hasUnknownOutcome: false, lastError: 'invalid_idempotency' })).toBe(false)
  })

  test('受付結果不明・分類なし・未知の分類は対象外', () => {
    expect(isManualResendEligibleDelivery({ status: 'REJECTED', hasUnknownOutcome: true, lastError: 'client' })).toBe(false)
    expect(isManualResendEligibleDelivery({ status: 'REJECTED', hasUnknownOutcome: false, lastError: null })).toBe(false)
    expect(isManualResendEligibleDelivery({ status: 'REJECTED', hasUnknownOutcome: false, lastError: 'server' })).toBe(false)
  })

  test.each(['PENDING', 'ACCEPTED', 'UNKNOWN', 'SKIPPED'] as const)('%s は対象外', (status) => {
    expect(isManualResendEligibleDelivery({ status, hasUnknownOutcome: false, lastError: 'client' })).toBe(false)
  })
})
