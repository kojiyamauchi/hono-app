import { beforeEach, describe, expect, mock, setSystemTime, test } from 'bun:test'

import { Prisma } from '@/generated/prisma/client'

const queryRaw = mock()
const deliveryDeleteMany = mock()
const deliveryCreate = mock()
const transaction = mock()

await mock.module('@/libs/prisma', () => ({ prisma: { $transaction: transaction } }))

const { invitationEmailResendRepository, invitationEmailResendResults } = await import('./emailResend')

const snapshot = { fromEmail: 'noreply@example.com', scalarUrl: 'https://example.com/open-api/scalar', templateVersion: 1 }
const input = { organizationId: 1, invitationId: 7, actorUserId: 3, snapshot }
const invitationRow = { id: 7, role: 'MEMBER', status: 'PENDING', expiresAt: new Date('2026-01-08T00:00:00.000Z') }
const deliveryRow = { status: 'REJECTED', hasUnknownOutcome: false, lastError: 'client', manualResendRequestedAt: null }

/** 段階ごとのコールバック。既定はすべて許可する。 */
const callbacksOf = (
  overrides: Partial<{
    authorizeOperator: (s: unknown) => string | null
    authorizeTarget: (s: unknown) => string | null
    evaluate: (s: unknown) => string | null
  }> = {},
): {
  authorizeOperator: ReturnType<typeof mock<(s: unknown) => string | null>>
  authorizeTarget: ReturnType<typeof mock<(s: unknown) => string | null>>
  evaluate: ReturnType<typeof mock<(s: unknown) => string | null>>
} => ({
  authorizeOperator: mock(overrides.authorizeOperator ?? ((_s: unknown) => null)),
  authorizeTarget: mock(overrides.authorizeTarget ?? ((_s: unknown) => null)),
  evaluate: mock(overrides.evaluate ?? ((_s: unknown) => null)),
})

/** tagged templateで呼ばれた$queryRawのSQL文字列を取り出す。 */
const sqlOf = (callIndex: number): string => {
  const [strings] = queryRaw.mock.calls[callIndex] as [string[]]
  return strings.join('?').replace(/\s+/g, ' ').trim()
}

/** ロック取得順に$queryRawの戻り値を設定する。 */
const mockLocks = (rows: unknown[][]): void => {
  for (const row of rows) queryRaw.mockResolvedValueOnce(row)
}

beforeEach(() => {
  queryRaw.mockReset()
  deliveryDeleteMany.mockReset()
  deliveryCreate.mockReset()
  transaction.mockReset()
  setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({ $queryRaw: queryRaw, invitationEmailDelivery: { deleteMany: deliveryDeleteMany, create: deliveryCreate } }),
  )
})

describe('invitationEmailResendRepository.requestResend', () => {
  test('READ COMMITTEDを明示してtransactionを開始する', async () => {
    mockLocks([[]])

    await invitationEmailResendRepository.requestResend(input, callbacksOf())

    expect(transaction.mock.calls[0]?.[1]).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })
  })

  test('組織・Membership・Invitation・配信行の順にロックし、許可時は配信行を新しいIDのPENDINGへ置き換える', async () => {
    mockLocks([[{ id: 1, name: 'Org' }], [{ role: 'OWNER' }], [invitationRow], [deliveryRow]])
    const callbacks = callbacksOf()

    const result = await invitationEmailResendRepository.requestResend(input, callbacks)

    expect(result).toEqual({ status: invitationEmailResendResults.requested })
    expect(queryRaw).toHaveBeenCalledTimes(4)
    expect(sqlOf(0)).toContain('FROM "Organization"')
    expect(sqlOf(0)).toContain('FOR KEY SHARE')
    expect(sqlOf(1)).toContain('FROM "Membership"')
    expect(sqlOf(1)).toContain('FOR SHARE')
    expect(sqlOf(2)).toContain('FROM "Invitation"')
    expect(sqlOf(2)).toContain('FOR NO KEY UPDATE')
    expect(sqlOf(3)).toContain('FROM "InvitationEmailDelivery"')
    expect(sqlOf(3)).toContain('FOR UPDATE')
    expect(callbacks.authorizeOperator).toHaveBeenCalledWith({ operatorRole: 'OWNER' })
    expect(callbacks.authorizeTarget).toHaveBeenCalledWith({
      operatorRole: 'OWNER',
      invitation: { role: 'MEMBER', status: 'PENDING', expiresAt: invitationRow.expiresAt },
    })
    expect(callbacks.evaluate).toHaveBeenCalledWith({
      invitation: { role: 'MEMBER', status: 'PENDING', expiresAt: invitationRow.expiresAt },
      delivery: deliveryRow,
      now: new Date('2026-01-01T00:00:00.000Z'),
    })
    expect(deliveryDeleteMany).toHaveBeenCalledWith({ where: { invitationId: 7 } })
    const data = deliveryCreate.mock.calls[0]?.[0].data
    expect(data).toMatchObject({
      invitationId: 7,
      fromEmail: snapshot.fromEmail,
      scalarUrl: snapshot.scalarUrl,
      templateVersion: 1,
      organizationName: 'Org',
      status: 'PENDING',
      attemptCount: 0,
      nextAttemptAt: new Date('2026-01-01T00:00:00.000Z'),
      deadline: new Date('2026-01-01T06:00:00.000Z'),
      manualResendRequestedAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    expect(typeof data.id).toBe('string')
    expect(data).not.toHaveProperty('leaseToken')
    expect(data).not.toHaveProperty('resendEmailId')
    expect(data).not.toHaveProperty('lastError')
    expect(data).not.toHaveProperty('hasUnknownOutcome')
  })

  test('招待の期限が6時間以内なら配信期限は招待の期限になる', async () => {
    mockLocks([[{ id: 1, name: 'Org' }], [{ role: 'OWNER' }], [{ ...invitationRow, expiresAt: new Date('2026-01-01T02:00:00.000Z') }], [deliveryRow]])

    await invitationEmailResendRepository.requestResend(input, callbacksOf())

    expect(deliveryCreate.mock.calls[0]?.[0].data.deadline).toEqual(new Date('2026-01-01T02:00:00.000Z'))
  })

  test('組織が存在しなければ以降をロックせずorganizationNotFoundを返す', async () => {
    mockLocks([[]])
    const callbacks = callbacksOf()

    const result = await invitationEmailResendRepository.requestResend(input, callbacks)

    expect(result).toEqual({ status: invitationEmailResendResults.organizationNotFound })
    expect(queryRaw).toHaveBeenCalledTimes(1)
    expect(callbacks.authorizeOperator).not.toHaveBeenCalled()
    expect(deliveryCreate).not.toHaveBeenCalled()
  })

  test('操作者が所属していなければorganizationNotFoundを返し、認可を呼ばない', async () => {
    mockLocks([[{ id: 1, name: 'Org' }], []])
    const callbacks = callbacksOf()

    const result = await invitationEmailResendRepository.requestResend(input, callbacks)

    expect(result).toEqual({ status: invitationEmailResendResults.organizationNotFound })
    expect(queryRaw).toHaveBeenCalledTimes(2)
    expect(callbacks.authorizeOperator).not.toHaveBeenCalled()
  })

  test('Membership確保時点で操作者の認可が拒否したら、招待・配信のSQLを発行しない', async () => {
    mockLocks([[{ id: 1, name: 'Org' }], [{ role: 'MEMBER' }]])
    const callbacks = callbacksOf({ authorizeOperator: () => 'operator-rejected' })

    const result = await invitationEmailResendRepository.requestResend(input, callbacks)

    expect(result).toEqual({ status: invitationEmailResendResults.rejected, rejection: 'operator-rejected' })
    expect(queryRaw).toHaveBeenCalledTimes(2)
    expect(callbacks.authorizeOperator).toHaveBeenCalledWith({ operatorRole: 'MEMBER' })
    expect(callbacks.authorizeTarget).not.toHaveBeenCalled()
    expect(deliveryDeleteMany).not.toHaveBeenCalled()
  })

  test('招待がなければinvitation: nullで対象の認可を呼び、拒否値を返して配信SQLを発行しない', async () => {
    mockLocks([[{ id: 1, name: 'Org' }], [{ role: 'ADMIN' }], []])
    const callbacks = callbacksOf({ authorizeTarget: () => 'not-found' })

    const result = await invitationEmailResendRepository.requestResend(input, callbacks)

    expect(result).toEqual({ status: invitationEmailResendResults.rejected, rejection: 'not-found' })
    expect(queryRaw).toHaveBeenCalledTimes(3)
    expect(callbacks.authorizeTarget).toHaveBeenCalledWith({ operatorRole: 'ADMIN', invitation: null })
    expect(callbacks.evaluate).not.toHaveBeenCalled()
  })

  test('対象ロールの認可が拒否したら、配信SQLを発行せず書き込まない', async () => {
    mockLocks([[{ id: 1, name: 'Org' }], [{ role: 'ADMIN' }], [{ ...invitationRow, role: 'ADMIN' }]])
    const callbacks = callbacksOf({ authorizeTarget: () => 'target-rejected' })

    const result = await invitationEmailResendRepository.requestResend(input, callbacks)

    expect(result).toEqual({ status: invitationEmailResendResults.rejected, rejection: 'target-rejected' })
    expect(queryRaw).toHaveBeenCalledTimes(3)
    expect(sqlOf(2)).toContain('FROM "Invitation"')
    expect(callbacks.evaluate).not.toHaveBeenCalled()
    expect(deliveryDeleteMany).not.toHaveBeenCalled()
    expect(deliveryCreate).not.toHaveBeenCalled()
  })

  test('配信行がなければdelivery: nullで判定し、拒否時は書き込まない', async () => {
    mockLocks([[{ id: 1, name: 'Org' }], [{ role: 'OWNER' }], [invitationRow], []])
    const callbacks = callbacksOf({ evaluate: () => 'no-delivery' })

    const result = await invitationEmailResendRepository.requestResend(input, callbacks)

    expect(result).toEqual({ status: invitationEmailResendResults.rejected, rejection: 'no-delivery' })
    expect(callbacks.evaluate).toHaveBeenCalledWith(expect.objectContaining({ delivery: null }))
    expect(deliveryCreate).not.toHaveBeenCalled()
  })

  test('許可されても送信設定がなければ書き込まずエラーにする', async () => {
    mockLocks([[{ id: 1, name: 'Org' }], [{ role: 'OWNER' }], [invitationRow], [deliveryRow]])

    await expect(invitationEmailResendRepository.requestResend({ ...input, snapshot: null }, callbacksOf())).rejects.toThrow()
    expect(deliveryDeleteMany).not.toHaveBeenCalled()
  })

  test('配信行の作成に失敗した場合はエラーを伝播し、transactionのrollbackに任せる', async () => {
    mockLocks([[{ id: 1, name: 'Org' }], [{ role: 'OWNER' }], [invitationRow], [deliveryRow]])
    deliveryCreate.mockRejectedValue(new Error('db failure'))

    await expect(invitationEmailResendRepository.requestResend(input, callbacksOf())).rejects.toThrow('db failure')
  })
})
