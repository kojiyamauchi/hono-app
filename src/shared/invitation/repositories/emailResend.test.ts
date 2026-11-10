import { beforeEach, describe, expect, mock, setSystemTime, test } from 'bun:test'

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
  test('組織・Membership・Invitation・配信行の順にロックし、許可時は配信行を新しいIDのPENDINGへ置き換える', async () => {
    mockLocks([[{ id: 1, name: 'Org' }], [{ role: 'OWNER' }], [invitationRow], [deliveryRow]])
    const authorize = mock((_state: unknown) => null as string | null)

    const result = await invitationEmailResendRepository.requestResend(input, authorize)

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
    expect(authorize).toHaveBeenCalledWith({
      operatorRole: 'OWNER',
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

    await invitationEmailResendRepository.requestResend(input, () => null)

    expect(deliveryCreate.mock.calls[0]?.[0].data.deadline).toEqual(new Date('2026-01-01T02:00:00.000Z'))
  })

  test('組織が存在しなければ以降をロックせずorganizationNotFoundを返す', async () => {
    mockLocks([[]])

    const result = await invitationEmailResendRepository.requestResend(input, () => null)

    expect(result).toEqual({ status: invitationEmailResendResults.organizationNotFound })
    expect(queryRaw).toHaveBeenCalledTimes(1)
    expect(deliveryCreate).not.toHaveBeenCalled()
  })

  test('操作者が所属していなければorganizationNotFoundを返す', async () => {
    mockLocks([[{ id: 1, name: 'Org' }], []])

    const result = await invitationEmailResendRepository.requestResend(input, () => null)

    expect(result).toEqual({ status: invitationEmailResendResults.organizationNotFound })
    expect(queryRaw).toHaveBeenCalledTimes(2)
  })

  test('招待がなければ配信行を読まず、invitation: nullで判定して拒否値をそのまま返す', async () => {
    mockLocks([[{ id: 1, name: 'Org' }], [{ role: 'ADMIN' }], []])
    const authorize = mock((_state: unknown) => 'rejected' as string | null)

    const result = await invitationEmailResendRepository.requestResend(input, authorize)

    expect(result).toEqual({ status: invitationEmailResendResults.rejected, rejection: 'rejected' })
    expect(queryRaw).toHaveBeenCalledTimes(3)
    expect(authorize.mock.calls[0]).toEqual([expect.objectContaining({ invitation: null, delivery: null })])
    expect(deliveryDeleteMany).not.toHaveBeenCalled()
  })

  test('配信行がなければdelivery: nullで判定し、拒否時は書き込まない', async () => {
    mockLocks([[{ id: 1, name: 'Org' }], [{ role: 'OWNER' }], [invitationRow], []])
    const authorize = mock((_state: unknown) => 'no-delivery' as string | null)

    const result = await invitationEmailResendRepository.requestResend(input, authorize)

    expect(result).toEqual({ status: invitationEmailResendResults.rejected, rejection: 'no-delivery' })
    expect(authorize.mock.calls[0]).toEqual([expect.objectContaining({ delivery: null })])
    expect(deliveryCreate).not.toHaveBeenCalled()
  })

  test('許可されても送信設定がなければ書き込まずエラーにする', async () => {
    mockLocks([[{ id: 1, name: 'Org' }], [{ role: 'OWNER' }], [invitationRow], [deliveryRow]])

    await expect(invitationEmailResendRepository.requestResend({ ...input, snapshot: null }, () => null)).rejects.toThrow()
    expect(deliveryDeleteMany).not.toHaveBeenCalled()
  })

  test('配信行の作成に失敗した場合はエラーを伝播し、transactionのrollbackに任せる', async () => {
    mockLocks([[{ id: 1, name: 'Org' }], [{ role: 'OWNER' }], [invitationRow], [deliveryRow]])
    deliveryCreate.mockRejectedValue(new Error('db failure'))

    await expect(invitationEmailResendRepository.requestResend(input, () => null)).rejects.toThrow('db failure')
  })
})
