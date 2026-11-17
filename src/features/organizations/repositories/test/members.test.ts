import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { Role } from '@/shared/membership/entities'

const queryRaw = mock()
const updateMany = mock()
const auditLogCreate = mock()
const transaction = mock()
const deleteMany = mock()
const findUnique = mock()

await mock.module('@/libs/prisma', () => ({
  prisma: { $transaction: transaction, membership: { deleteMany, findUnique } },
}))

const { leaveOrganizationResults, memberRemovalResults, memberRoleChangeResults, membersRepository } = await import('../members')

type MembershipRow = {
  id: number
  userId: number
  organizationId: number
  role: Role
}

/** transactionモックへロックと更新を行うclientを設定する。 */
const prepareTransaction = (): void => {
  transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({ $queryRaw: queryRaw, membership: { updateMany, deleteMany }, auditLog: { create: auditLogCreate } }),
  )
}

describe('membersRepository.changeRole', () => {
  type LockedRow = MembershipRow & { createdAt: Date }

  const createdAt = new Date('2026-01-01T00:00:00.000Z')
  const operatorRow: LockedRow = { id: 1, userId: 1, organizationId: 1, role: 'OWNER', createdAt }
  const targetRow: LockedRow = { id: 10, userId: 2, organizationId: 1, role: 'MEMBER', createdAt }
  const input = { organizationId: 1, targetMembershipId: 10, actorUserId: 1, newRole: 'ADMIN' } as const

  /** 常に許可するコールバック。 */
  const allow = mock((): string | null => null)

  beforeEach(() => {
    queryRaw.mockReset()
    updateMany.mockReset()
    auditLogCreate.mockReset()
    transaction.mockReset()
    allow.mockClear()
    prepareTransaction()
  })

  /** Organization行のロック結果とMembership行のロック結果を順番に設定する。 */
  const prepareRoleChangeLocks = (rows: LockedRow[] = [operatorRow, targetRow]): void => {
    queryRaw.mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce(rows)
  }

  /** tagged templateで呼ばれた$queryRawのSQL文字列と埋め込み値を取り出す。 */
  const queryOf = (callIndex: number): { sql: string; values: unknown[] } => {
    const [strings, ...values] = queryRaw.mock.calls[callIndex] as [string[], ...unknown[]]
    return { sql: strings.join('?').replace(/\s+/g, ' ').trim(), values }
  }

  test('Organization(FOR NO KEY UPDATE)、Membership(FOR UPDATE)の順でロックし、更新後に監査ログを追加する', async () => {
    const callOrder: string[] = []
    queryRaw
      .mockImplementationOnce(async () => {
        callOrder.push('organization-lock')
        return [{ id: 1 }]
      })
      .mockImplementationOnce(async () => {
        callOrder.push('membership-lock')
        return [operatorRow, targetRow]
      })
    updateMany.mockImplementationOnce(async () => {
      callOrder.push('role-update')
      return { count: 1 }
    })
    auditLogCreate.mockImplementationOnce(async () => {
      callOrder.push('audit-log-create')
      return undefined
    })

    const result = await membersRepository.changeRole(input, allow)

    expect(result).toEqual({ status: memberRoleChangeResults.changed, membership: { ...targetRow, role: 'ADMIN' } })
    expect(callOrder).toEqual(['organization-lock', 'membership-lock', 'role-update', 'audit-log-create'])
    expect(queryOf(0).sql).toContain('FROM "Organization"')
    expect(queryOf(0).sql).toContain('FOR NO KEY UPDATE')
    expect(queryOf(0).values).toEqual([1])
    expect(queryOf(1).sql).toContain('ORDER BY id ASC FOR UPDATE')
    // 組織で絞り込み、別組織のMembership行をロックしない
    expect(queryOf(1).sql).toContain('"organizationId" =')
    expect(queryOf(1).values).toEqual([1, 1, 10])
    expect(allow).toHaveBeenCalledWith({ operatorRole: 'OWNER', targetRole: 'MEMBER' })
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 10, organizationId: 1, role: 'MEMBER' }, data: { role: 'ADMIN' } })
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: {
        organizationId: 1,
        action: 'MEMBER_ROLE_CHANGED',
        actorUserId: 1,
        targetUserId: 2,
        targetMembershipId: 10,
        previousRole: 'MEMBER',
        newRole: 'ADMIN',
      },
    })
  })

  test('監査ログにはロック後に読み直した変更前ロールと対象ユーザーIDを記録する', async () => {
    prepareRoleChangeLocks([operatorRow, { ...targetRow, userId: 7, role: 'ADMIN' }])
    updateMany.mockResolvedValueOnce({ count: 1 })

    const result = await membersRepository.changeRole({ ...input, newRole: 'MEMBER' }, allow)

    expect(result.status).toBe(memberRoleChangeResults.changed)
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ targetUserId: 7, previousRole: 'ADMIN', newRole: 'MEMBER' }),
    })
  })

  test('操作者と対象が同じメンバーシップでも1行で判定できる', async () => {
    prepareRoleChangeLocks([operatorRow])
    updateMany.mockResolvedValueOnce({ count: 1 })

    const result = await membersRepository.changeRole({ ...input, targetMembershipId: 1, newRole: 'ADMIN' }, allow)

    expect(result.status).toBe(memberRoleChangeResults.changed)
    expect(allow).toHaveBeenCalledWith({ operatorRole: 'OWNER', targetRole: 'OWNER' })
  })

  test('Organization行が取得できなければORGANIZATION_NOT_FOUNDを返し、以降のロックも書き込みもしない', async () => {
    queryRaw.mockResolvedValueOnce([])

    const result = await membersRepository.changeRole(input, allow)

    expect(result).toEqual({ status: memberRoleChangeResults.organizationNotFound })
    expect(queryRaw).toHaveBeenCalledTimes(1)
    expect(allow).not.toHaveBeenCalled()
    expect(updateMany).not.toHaveBeenCalled()
    expect(auditLogCreate).not.toHaveBeenCalled()
  })

  test('操作者のMembershipが消えていればORGANIZATION_NOT_FOUNDを返す', async () => {
    prepareRoleChangeLocks([targetRow])

    const result = await membersRepository.changeRole(input, allow)

    expect(result).toEqual({ status: memberRoleChangeResults.organizationNotFound })
    expect(allow).not.toHaveBeenCalled()
    expect(updateMany).not.toHaveBeenCalled()
    expect(auditLogCreate).not.toHaveBeenCalled()
  })

  test('対象が存在しない、または別組織でロック対象に入らなければTARGET_NOT_FOUNDを返す', async () => {
    // 別組織の対象はWHERE句の組織条件で除外されるため、操作者の行だけが返る
    prepareRoleChangeLocks([operatorRow])

    const result = await membersRepository.changeRole(input, allow)

    expect(result).toEqual({ status: memberRoleChangeResults.targetNotFound })
    expect(allow).not.toHaveBeenCalled()
    expect(updateMany).not.toHaveBeenCalled()
    expect(auditLogCreate).not.toHaveBeenCalled()
  })

  test('認可コールバックが拒否値を返せば書き込まずにREJECTEDとその値を返す', async () => {
    prepareRoleChangeLocks([
      { ...operatorRow, role: 'ADMIN' },
      { ...targetRow, role: 'ADMIN' },
    ])
    const deny = mock((): string | null => '拒否')

    const result = await membersRepository.changeRole(input, deny)

    expect(result).toEqual({ status: memberRoleChangeResults.rejected, rejection: '拒否' })
    expect(deny).toHaveBeenCalledWith({ operatorRole: 'ADMIN', targetRole: 'ADMIN' })
    expect(updateMany).not.toHaveBeenCalled()
    expect(auditLogCreate).not.toHaveBeenCalled()
  })

  test('現在のロールと同じ指定ならUNCHANGEDで現在のmembershipを返し、更新も記録もしない', async () => {
    prepareRoleChangeLocks()

    const result = await membersRepository.changeRole({ ...input, newRole: 'MEMBER' }, allow)

    expect(result).toEqual({ status: memberRoleChangeResults.unchanged, membership: targetRow })
    expect(updateMany).not.toHaveBeenCalled()
    expect(auditLogCreate).not.toHaveBeenCalled()
  })

  test('条件付き更新が0件ならtransactionを失敗させてCONFLICTを返し、記録しない', async () => {
    prepareRoleChangeLocks()
    updateMany.mockResolvedValueOnce({ count: 0 })

    const result = await membersRepository.changeRole(input, allow)

    expect(result).toEqual({ status: memberRoleChangeResults.conflict })
    expect(auditLogCreate).not.toHaveBeenCalled()
  })

  test('監査ログの追加に失敗したらそのままthrowし、transactionをrollbackさせる', async () => {
    prepareRoleChangeLocks()
    updateMany.mockResolvedValueOnce({ count: 1 })
    auditLogCreate.mockRejectedValueOnce(new Error('INSERT失敗'))

    await expect(membersRepository.changeRole(input, allow)).rejects.toThrow('INSERT失敗')
  })

  test('予期しないDBエラーはそのままthrowする', async () => {
    queryRaw.mockRejectedValueOnce(new Error('接続エラー'))

    await expect(membersRepository.changeRole(input, allow)).rejects.toThrow('接続エラー')
  })
})

describe('membersRepository.remove', () => {
  type LockedRow = MembershipRow & { createdAt: Date }

  const createdAt = new Date('2026-01-01T00:00:00.000Z')
  const operatorRow: LockedRow = { id: 1, userId: 1, organizationId: 1, role: 'OWNER', createdAt }
  const targetRow: LockedRow = { id: 10, userId: 2, organizationId: 1, role: 'MEMBER', createdAt }
  const input = { organizationId: 1, targetMembershipId: 10, actorUserId: 1 } as const

  /** 常に許可するコールバック。 */
  const allow = mock((): string | null => null)

  beforeEach(() => {
    queryRaw.mockReset()
    deleteMany.mockReset()
    auditLogCreate.mockReset()
    transaction.mockReset()
    allow.mockClear()
    prepareTransaction()
  })

  /** Organization行のロック結果とMembership行のロック結果を順番に設定する。 */
  const prepareRemovalLocks = (rows: LockedRow[] = [operatorRow, targetRow]): void => {
    queryRaw.mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce(rows)
  }

  /** tagged templateで呼ばれた$queryRawのSQL文字列と埋め込み値を取り出す。 */
  const queryOf = (callIndex: number): { sql: string; values: unknown[] } => {
    const [strings, ...values] = queryRaw.mock.calls[callIndex] as [string[], ...unknown[]]
    return { sql: strings.join('?').replace(/\s+/g, ' ').trim(), values }
  }

  test('Organization(FOR NO KEY UPDATE)、Membership(FOR UPDATE)の順でロックし、削除後に監査ログを追加する', async () => {
    const callOrder: string[] = []
    queryRaw
      .mockImplementationOnce(async () => {
        callOrder.push('organization-lock')
        return [{ id: 1 }]
      })
      .mockImplementationOnce(async () => {
        callOrder.push('membership-lock')
        return [operatorRow, targetRow]
      })
    deleteMany.mockImplementationOnce(async () => {
      callOrder.push('membership-delete')
      return { count: 1 }
    })
    auditLogCreate.mockImplementationOnce(async () => {
      callOrder.push('audit-log-create')
      return undefined
    })

    const result = await membersRepository.remove(input, allow)

    expect(result).toEqual({ status: memberRemovalResults.removed })
    expect(callOrder).toEqual(['organization-lock', 'membership-lock', 'membership-delete', 'audit-log-create'])
    expect(queryOf(0).sql).toContain('FROM "Organization"')
    expect(queryOf(0).sql).toContain('FOR NO KEY UPDATE')
    expect(queryOf(0).values).toEqual([1])
    expect(queryOf(1).sql).toContain('ORDER BY id ASC FOR UPDATE')
    // 組織で絞り込み、別組織のMembership行をロックしない
    expect(queryOf(1).sql).toContain('"organizationId" =')
    expect(queryOf(1).values).toEqual([1, 1, 10])
    expect(allow).toHaveBeenCalledWith({ operatorRole: 'OWNER', targetRole: 'MEMBER' })
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: 10, organizationId: 1, role: 'MEMBER' } })
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: {
        organizationId: 1,
        action: 'MEMBER_REMOVED',
        actorUserId: 1,
        targetUserId: 2,
        targetMembershipId: 10,
        previousRole: 'MEMBER',
        newRole: null,
      },
    })
  })

  test.each([
    { name: 'OWNERがADMINを削除', operatorRole: 'OWNER', targetRole: 'ADMIN' },
    { name: 'OWNERがMEMBERを削除', operatorRole: 'OWNER', targetRole: 'MEMBER' },
    { name: 'ADMINがMEMBERを削除', operatorRole: 'ADMIN', targetRole: 'MEMBER' },
  ] as const)('$name: ロック後のロールをpreviousRoleとして記録する', async ({ operatorRole, targetRole }) => {
    prepareRemovalLocks([
      { ...operatorRow, role: operatorRole },
      { ...targetRow, userId: 7, role: targetRole },
    ])
    deleteMany.mockResolvedValueOnce({ count: 1 })

    const result = await membersRepository.remove(input, allow)

    expect(result.status).toBe(memberRemovalResults.removed)
    expect(allow).toHaveBeenCalledWith({ operatorRole, targetRole })
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'MEMBER_REMOVED', targetUserId: 7, previousRole: targetRole, newRole: null }),
    })
  })

  test('Organization行が取得できなければORGANIZATION_NOT_FOUNDを返し、以降のロックも書き込みもしない', async () => {
    queryRaw.mockResolvedValueOnce([])

    const result = await membersRepository.remove(input, allow)

    expect(result).toEqual({ status: memberRemovalResults.organizationNotFound })
    expect(queryRaw).toHaveBeenCalledTimes(1)
    expect(allow).not.toHaveBeenCalled()
    expect(deleteMany).not.toHaveBeenCalled()
    expect(auditLogCreate).not.toHaveBeenCalled()
  })

  test('操作者のMembershipが存在しなければORGANIZATION_NOT_FOUNDを返す', async () => {
    prepareRemovalLocks([targetRow])

    const result = await membersRepository.remove(input, allow)

    expect(result).toEqual({ status: memberRemovalResults.organizationNotFound })
    expect(allow).not.toHaveBeenCalled()
    expect(deleteMany).not.toHaveBeenCalled()
    expect(auditLogCreate).not.toHaveBeenCalled()
  })

  test('対象が存在しない、または別組織でロック対象に入らなければ、認可後にTARGET_NOT_FOUNDを返す', async () => {
    // 別組織の対象はWHERE句の組織条件で除外されるため、操作者の行だけが返る
    prepareRemovalLocks([operatorRow])

    const result = await membersRepository.remove(input, allow)

    expect(result).toEqual({ status: memberRemovalResults.targetNotFound })
    expect(allow).toHaveBeenCalledWith({ operatorRole: 'OWNER', targetRole: null })
    expect(deleteMany).not.toHaveBeenCalled()
    expect(auditLogCreate).not.toHaveBeenCalled()
  })

  test('対象が存在しなくても、認可コールバックが拒否すれば対象の有無より先にREJECTEDを返す', async () => {
    prepareRemovalLocks([{ ...operatorRow, role: 'MEMBER' }])
    const deny = mock((): string | null => '拒否')

    const result = await membersRepository.remove(input, deny)

    expect(result).toEqual({ status: memberRemovalResults.rejected, rejection: '拒否' })
    expect(deny).toHaveBeenCalledWith({ operatorRole: 'MEMBER', targetRole: null })
    expect(deleteMany).not.toHaveBeenCalled()
    expect(auditLogCreate).not.toHaveBeenCalled()
  })

  test('認可コールバックが拒否値を返せば削除も記録もせずREJECTEDとその値を返す', async () => {
    prepareRemovalLocks([
      { ...operatorRow, role: 'ADMIN' },
      { ...targetRow, role: 'ADMIN' },
    ])
    const deny = mock((): string | null => '拒否')

    const result = await membersRepository.remove(input, deny)

    expect(result).toEqual({ status: memberRemovalResults.rejected, rejection: '拒否' })
    expect(deny).toHaveBeenCalledWith({ operatorRole: 'ADMIN', targetRole: 'ADMIN' })
    expect(deleteMany).not.toHaveBeenCalled()
    expect(auditLogCreate).not.toHaveBeenCalled()
  })

  test('削除が0件ならTARGET_NOT_FOUNDを返し、記録しない', async () => {
    prepareRemovalLocks()
    deleteMany.mockResolvedValueOnce({ count: 0 })

    const result = await membersRepository.remove(input, allow)

    expect(result).toEqual({ status: memberRemovalResults.targetNotFound })
    expect(auditLogCreate).not.toHaveBeenCalled()
  })

  test('監査ログの追加に失敗したらそのままthrowし、transactionをrollbackさせる', async () => {
    prepareRemovalLocks()
    deleteMany.mockResolvedValueOnce({ count: 1 })
    auditLogCreate.mockRejectedValueOnce(new Error('INSERT失敗'))

    await expect(membersRepository.remove(input, allow)).rejects.toThrow('INSERT失敗')
  })

  test('予期しないDBエラーはそのままthrowする', async () => {
    queryRaw.mockRejectedValueOnce(new Error('接続エラー'))

    await expect(membersRepository.remove(input, allow)).rejects.toThrow('接続エラー')
  })
})

describe('membersRepository.leave', () => {
  beforeEach(() => {
    deleteMany.mockReset()
    findUnique.mockReset()
  })

  test('認証ユーザー自身のOWNER以外のmembershipを条件付きで削除する', async () => {
    deleteMany.mockResolvedValue({ count: 1 })

    const result = await membersRepository.leave(1, 2)

    expect(result).toBe(leaveOrganizationResults.left)
    expect(deleteMany).toHaveBeenCalledWith({
      where: { organizationId: 1, userId: 2, role: { not: 'OWNER' } },
    })
    expect(findUnique).not.toHaveBeenCalled()
  })

  test('条件付き削除が0件で最新ロールがOWNERならOWNERを返す', async () => {
    deleteMany.mockResolvedValue({ count: 0 })
    findUnique.mockResolvedValue({ role: 'OWNER' })

    const result = await membersRepository.leave(1, 2)

    expect(result).toBe(leaveOrganizationResults.owner)
    expect(deleteMany).toHaveBeenCalledTimes(1)
  })

  test('条件付き削除が0件でmembershipがなければNOT_MEMBERを返す', async () => {
    deleteMany.mockResolvedValue({ count: 0 })
    findUnique.mockResolvedValue(null)

    const result = await membersRepository.leave(1, 2)

    expect(result).toBe(leaveOrganizationResults.notMember)
    expect(findUnique).toHaveBeenCalledWith({
      where: { userId_organizationId: { userId: 2, organizationId: 1 } },
      select: { role: true },
    })
  })

  test('競合後の最新ロールがADMINまたはMEMBERなら条件付き削除を再試行する', async () => {
    deleteMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 })
    findUnique.mockResolvedValue({ role: 'ADMIN' })

    const result = await membersRepository.leave(1, 2)

    expect(result).toBe(leaveOrganizationResults.left)
    expect(deleteMany).toHaveBeenCalledTimes(2)
    expect(findUnique).toHaveBeenCalledTimes(1)
  })

  test('再試行後も削除できず最新ロールがOWNER以外ならCONFLICTを返す', async () => {
    deleteMany.mockResolvedValue({ count: 0 })
    findUnique.mockResolvedValue({ role: 'MEMBER' })

    const result = await membersRepository.leave(1, 2)

    expect(result).toBe(leaveOrganizationResults.conflict)
    expect(deleteMany).toHaveBeenCalledTimes(2)
    expect(findUnique).toHaveBeenCalledTimes(2)
  })

  test('予期しないDBエラーはそのままthrowする', async () => {
    deleteMany.mockRejectedValue(new Error('接続エラー'))

    await expect(membersRepository.leave(1, 2)).rejects.toThrow('接続エラー')
  })
})
