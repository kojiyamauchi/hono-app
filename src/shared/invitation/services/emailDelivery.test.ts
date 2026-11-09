import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'

import type { ClaimedInvitationEmail, InvitationEmailClaim } from '../repositories/emailDelivery'

const claim = mock<() => Promise<InvitationEmailClaim | undefined>>()
const readClaim = mock<() => Promise<ClaimedInvitationEmail | null>>()
const finish = mock()
await mock.module('../repositories/emailDelivery', () => ({
  invitationEmailDeliveryRepository: { claim, readClaim, finish },
}))
const { deliverInvitationEmails } = await import('./emailDelivery')
const fetchSpy = spyOn(globalThis, 'fetch')

let currentClaim: InvitationEmailClaim
let email: ClaimedInvitationEmail
const previousKey = process.env.RESEND_API_KEY

beforeEach(() => {
  process.env.RESEND_API_KEY = 'test-key'
  currentClaim = {
    id: 'delivery-id',
    leaseToken: 'lease-token',
    attemptCount: 1,
    previousAttemptCount: 0,
    hasUnknownOutcome: false,
    deadline: new Date(Date.now() + 6 * 3_600_000),
  }
  email = {
    leaseUntil: new Date(Date.now() + 60_000),
    fromEmail: 'sender@example.com',
    scalarUrl: 'https://example.com/open-api/scalar',
    organizationName: '検証組織',
    templateVersion: 1,
    invitation: {
      email: 'recipient@example.com',
      token: 'sensitive-token',
      expiresAt: new Date('2099-01-01T00:00:00Z'),
      status: 'PENDING',
    },
  }
  claim.mockReset()
  claim.mockResolvedValueOnce(currentClaim).mockResolvedValue(undefined)
  readClaim.mockReset()
  readClaim.mockResolvedValue(email)
  finish.mockReset()
  fetchSpy.mockReset()
})

afterEach(() => {
  if (previousKey === undefined) delete process.env.RESEND_API_KEY
  else process.env.RESEND_API_KEY = previousKey
})

describe('招待メールワーカー', () => {
  test('処理権が変わっても同じIDと保存したペイロードで送信する', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 503 }))
    fetchSpy.mockResolvedValueOnce(Response.json({ id: 'email-id' }))
    await deliverInvitationEmails()

    const secondClaim = { ...currentClaim, attemptCount: 2, previousAttemptCount: 1, hasUnknownOutcome: true, leaseToken: 'new-lease' }
    claim.mockResolvedValueOnce(secondClaim)
    await deliverInvitationEmails()

    const firstRequest = fetchSpy.mock.calls[0][1]
    const secondRequest = fetchSpy.mock.calls[1][1]
    expect(firstRequest?.headers).toHaveProperty('Idempotency-Key', currentClaim.id)
    expect(secondRequest?.headers).toEqual(firstRequest?.headers)
    expect(secondRequest?.body).toBe(firstRequest?.body)
    expect(firstRequest?.signal).toBeInstanceOf(AbortSignal)

    const payload = JSON.parse(String(firstRequest?.body))
    expect(payload.from).toBe(email.fromEmail)
    expect(payload.to).toBe(email.invitation.email)
    expect(payload.subject).not.toContain(email.invitation.token)
    expect(payload.text).toContain(`\n${email.scalarUrl}\n`)
    expect(payload.text).toContain(`\n${email.invitation.token}`)
    expect(payload.text).toContain('POST /invitations/accept')
    expect(payload.text).toContain('POST /invitations/signup')
    expect(finish).toHaveBeenLastCalledWith(secondClaim, {
      status: 'ACCEPTED',
      resendEmailId: 'email-id',
      lastError: null,
      hasUnknownOutcome: false,
    })
  })

  test.each([
    [1, 15, 429, '', 'rate_limited', false],
    [2, 30, 503, '', 'server', true],
    [3, 60, 409, 'concurrent_idempotent_requests', 'concurrent', true],
    [4, 120, 503, '', 'server', true],
  ] as const)('試行%dの一時障害を%d分後まで待つ', async (attempt, delay, status, name, reason, unknown) => {
    currentClaim.attemptCount = attempt
    currentClaim.previousAttemptCount = attempt - 1
    fetchSpy.mockResolvedValueOnce(Response.json({ name, message: '機密情報を含みうる外部エラー' }, { status }))
    const started = Date.now()
    await deliverInvitationEmails()
    const result = finish.mock.calls[0][1]
    expect(result).toMatchObject({ hasUnknownOutcome: unknown, lastError: reason })
    expect(result.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(started + delay * 60_000)
    expect(result.nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now() + delay * 60_000)
  })

  test('一時障害の次回時刻を配信期限で打ち切る', async () => {
    currentClaim.deadline = new Date(Date.now() + 30_000)
    fetchSpy.mockRejectedValueOnce(new DOMException('機密情報を含みうる例外', 'TimeoutError'))
    await deliverInvitationEmails()
    expect(finish).toHaveBeenCalledWith(currentClaim, {
      nextAttemptAt: currentClaim.deadline,
      hasUnknownOutcome: true,
      lastError: 'transport',
    })
  })

  test.each([
    [false, 'REJECTED'],
    [true, 'UNKNOWN'],
  ] as const)('冪等キーの恒久エラーで終了する（過去の受付結果不明 %s）', async (unknown, status) => {
    currentClaim.hasUnknownOutcome = unknown
    fetchSpy.mockResolvedValueOnce(Response.json({ name: 'invalid_idempotent_request' }, { status: 409 }))
    await deliverInvitationEmails()
    expect(finish).toHaveBeenCalledWith(currentClaim, { status, hasUnknownOutcome: unknown, lastError: 'invalid_idempotency' })
  })

  test('5回目の通信失敗は受付結果不明で終了する', async () => {
    currentClaim.attemptCount = 5
    currentClaim.previousAttemptCount = 4
    fetchSpy.mockRejectedValueOnce(new Error('接続エラー'))
    await deliverInvitationEmails()
    expect(finish).toHaveBeenCalledWith(currentClaim, { status: 'UNKNOWN', hasUnknownOutcome: true, lastError: 'transport' })
  })

  test.each([
    ['CANCELED', false, 'SKIPPED'],
    ['ACCEPTED', true, 'UNKNOWN'],
    ['DECLINED', false, 'SKIPPED'],
    ['EXPIRED', false, 'SKIPPED'],
  ] as const)('無効な招待 %s は外部APIを呼ばない', async (invitationStatus, unknown, status) => {
    email.invitation.status = invitationStatus
    currentClaim.hasUnknownOutcome = unknown
    if (unknown) {
      currentClaim.previousAttemptCount = 1
      currentClaim.attemptCount = 2
    }
    await deliverInvitationEmails()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(finish).toHaveBeenCalledWith(currentClaim, { status, attemptCount: unknown ? 1 : 0, lastError: 'inactive' })
  })

  test('未試行の配信期限切れを回収する', async () => {
    currentClaim.deadline = new Date(0)
    await deliverInvitationEmails()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(finish).toHaveBeenCalledWith(currentClaim, { status: 'SKIPPED', attemptCount: 0, lastError: 'expired' })
  })

  test('429のみの試行後に招待が無効になった配信は対象外にする', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 429 }))
    await deliverInvitationEmails()
    expect(finish).toHaveBeenLastCalledWith(currentClaim, expect.objectContaining({ hasUnknownOutcome: false, lastError: 'rate_limited' }))

    email.invitation.status = 'CANCELED'
    const nextClaim = { ...currentClaim, attemptCount: 2, previousAttemptCount: 1 }
    claim.mockResolvedValueOnce(nextClaim)
    await deliverInvitationEmails()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(finish).toHaveBeenLastCalledWith(nextClaim, { status: 'SKIPPED', attemptCount: 1, lastError: 'inactive' })
  })

  test('最後の試行の処理権が期限切れになった配信を回収する', async () => {
    currentClaim.attemptCount = 5
    currentClaim.previousAttemptCount = 5
    currentClaim.hasUnknownOutcome = true
    await deliverInvitationEmails()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(finish).toHaveBeenCalledWith(currentClaim, { status: 'UNKNOWN', attemptCount: 5, lastError: 'attempt_limit' })
  })

  test('処理権を失った場合は送信や結果更新を行わない', async () => {
    readClaim.mockResolvedValueOnce(null)
    await deliverInvitationEmails()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(finish).not.toHaveBeenCalled()
  })

  test('送信に必要な残り時間がなければ、未試行のまま処理権を解放する', async () => {
    email.leaseUntil = new Date(Date.now() + 1000)
    await deliverInvitationEmails()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(finish).toHaveBeenCalledWith(currentClaim, { attemptCount: 0, nextAttemptAt: expect.any(Date) })
  })

  test('未対応のテンプレートは送信せず受付結果不明にもせず再試行を待つ', async () => {
    email.templateVersion = 2
    await deliverInvitationEmails()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(finish).toHaveBeenCalledWith(currentClaim, {
      nextAttemptAt: expect.any(Date),
      hasUnknownOutcome: false,
      lastError: 'template_version',
    })
  })

  test('1件のDBエラー後も次の配信を処理し、例外詳細をログに含めない', async () => {
    const nextClaim = { ...currentClaim, id: 'next-delivery' }
    claim.mockResolvedValueOnce(nextClaim)
    readClaim.mockRejectedValueOnce(new Error('機密情報を含みうるDBエラー'))
    fetchSpy.mockResolvedValueOnce(Response.json({ id: 'email-id' }))
    const log = spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await expect(deliverInvitationEmails()).rejects.toThrow('招待メールの配信処理に失敗しました')
      expect(finish).toHaveBeenCalledTimes(1)
      expect(finish).toHaveBeenCalledWith(nextClaim, expect.objectContaining({ status: 'ACCEPTED' }))
      expect(log).toHaveBeenCalledTimes(1)
      expect(log).toHaveBeenCalledWith('招待メールの配信処理に失敗しました', { deliveryId: currentClaim.id, attemptCount: 1 })
    } finally {
      log.mockRestore()
    }
  })

  test('実行ごとに最大30件で停止する', async () => {
    claim.mockResolvedValue(currentClaim)
    readClaim.mockResolvedValue(null)
    expect(await deliverInvitationEmails()).toBe(30)
    expect(claim).toHaveBeenCalledTimes(30)
  })
})
