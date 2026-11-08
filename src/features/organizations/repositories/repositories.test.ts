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

const {
  leaveOrganizationResults,
  memberRoleChangeResults,
  organizationMemberRoleRepository,
  organizationMembershipRepository,
  organizationOwnershipRepository,
  ownershipTransferResults,
} = await import('.')

type MembershipRow = {
  id: number
  userId: number
  organizationId: number
  role: Role
}

const owner: MembershipRow = { id: 1, userId: 1, organizationId: 1, role: 'OWNER' }
const target: MembershipRow = { id: 2, userId: 2, organizationId: 1, role: 'MEMBER' }

/** transactionモックへロックと更新を行うclientを設定する。 */
const prepareTransaction = (): void => {
  transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({ $queryRaw: queryRaw, membership: { updateMany }, auditLog: { create: auditLogCreate } }),
  )
}

/** User、Organization、Membershipの各ロック結果を順番に設定する。 */
const prepareLocks = (memberships: MembershipRow[] = [owner, target]): void => {
  queryRaw
    .mockResolvedValueOnce([{ id: target.userId }])
    .mockResolvedValueOnce([{ id: 1 }])
    .mockResolvedValueOnce(memberships)
}

describe('organizationOwnershipRepository.transferOwnership', () => {
  beforeEach(() => {
    queryRaw.mockReset()
    updateMany.mockReset()
    transaction.mockReset()
    prepareTransaction()
  })

  test('User、Organization、Membershipの順でロックして移譲する', async () => {
    const callOrder: string[] = []
    queryRaw
      .mockImplementationOnce(async () => {
        callOrder.push('user-lock')
        return [{ id: 2 }]
      })
      .mockImplementationOnce(async () => {
        callOrder.push('organization-lock')
        return [{ id: 1 }]
      })
      .mockImplementationOnce(async () => {
        callOrder.push('membership-lock')
        return [owner, target]
      })
    updateMany
      .mockImplementationOnce(async () => {
        callOrder.push('target-promote')
        return { count: 1 }
      })
      .mockImplementationOnce(async () => {
        callOrder.push('owner-demote')
        return { count: 1 }
      })

    const result = await organizationOwnershipRepository.transferOwnership(1, 1, 2)

    expect(result).toBe(ownershipTransferResults.transferred)
    expect(callOrder).toEqual(['user-lock', 'organization-lock', 'membership-lock', 'target-promote', 'owner-demote'])
    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 2, userId: 2, organizationId: 1, role: { in: ['ADMIN', 'MEMBER'] } },
      data: { role: 'OWNER' },
    })
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 1, userId: 1, organizationId: 1, role: 'OWNER' },
      data: { role: 'ADMIN' },
    })
  })

  test('移譲先が存在しない場合はTARGET_NOT_FOUNDを返す', async () => {
    queryRaw.mockResolvedValueOnce([])

    const result = await organizationOwnershipRepository.transferOwnership(1, 1, 999)

    expect(result).toBe(ownershipTransferResults.targetNotFound)
    expect(queryRaw).toHaveBeenCalledTimes(1)
    expect(updateMany).not.toHaveBeenCalled()
  })

  test('組織が存在しない場合はCONFLICTを返す', async () => {
    queryRaw.mockResolvedValueOnce([{ id: target.userId }]).mockResolvedValueOnce([])

    const result = await organizationOwnershipRepository.transferOwnership(1, 1, 2)

    expect(result).toBe(ownershipTransferResults.conflict)
    expect(queryRaw).toHaveBeenCalledTimes(2)
    expect(updateMany).not.toHaveBeenCalled()
  })

  test('移譲先が別組織のメンバーならTARGET_NOT_FOUNDを返す', async () => {
    prepareLocks([owner, { ...target, organizationId: 2 }])

    const result = await organizationOwnershipRepository.transferOwnership(1, 1, 2)

    expect(result).toBe(ownershipTransferResults.targetNotFound)
    expect(updateMany).not.toHaveBeenCalled()
  })

  test('自分自身への移譲ならSELF_TRANSFERを返す', async () => {
    queryRaw
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([owner])

    const result = await organizationOwnershipRepository.transferOwnership(1, 1, 1)

    expect(result).toBe(ownershipTransferResults.selfTransfer)
    expect(updateMany).not.toHaveBeenCalled()
  })

  test('ロック後に実行者がOWNERでなくなっていればCONFLICTを返す', async () => {
    prepareLocks([{ ...owner, role: 'ADMIN' }, target])

    const result = await organizationOwnershipRepository.transferOwnership(1, 1, 2)

    expect(result).toBe(ownershipTransferResults.conflict)
    expect(updateMany).not.toHaveBeenCalled()
  })

  test('移譲先がADMINまたはMEMBERでなければCONFLICTを返す', async () => {
    prepareLocks([owner, { ...target, role: 'OWNER' }])

    const result = await organizationOwnershipRepository.transferOwnership(1, 1, 2)

    expect(result).toBe(ownershipTransferResults.conflict)
    expect(updateMany).not.toHaveBeenCalled()
  })

  test('更新途中の競合はtransactionを失敗させてCONFLICTへ変換する', async () => {
    prepareLocks()
    updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })

    const result = await organizationOwnershipRepository.transferOwnership(1, 1, 2)

    expect(result).toBe(ownershipTransferResults.conflict)
    expect(updateMany).toHaveBeenCalledTimes(2)
  })

  test('予期しないDBエラーはそのままthrowする', async () => {
    const error = new Error('接続エラー')
    queryRaw.mockRejectedValueOnce(error)

    await expect(organizationOwnershipRepository.transferOwnership(1, 1, 2)).rejects.toThrow('接続エラー')
  })
})

describe('organizationMemberRoleRepository.changeRoleWithAuditLog', () => {
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

    const result = await organizationMemberRoleRepository.changeRoleWithAuditLog(input, allow)

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

    const result = await organizationMemberRoleRepository.changeRoleWithAuditLog({ ...input, newRole: 'MEMBER' }, allow)

    expect(result.status).toBe(memberRoleChangeResults.changed)
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ targetUserId: 7, previousRole: 'ADMIN', newRole: 'MEMBER' }),
    })
  })

  test('操作者と対象が同じメンバーシップでも1行で判定できる', async () => {
    prepareRoleChangeLocks([operatorRow])
    updateMany.mockResolvedValueOnce({ count: 1 })

    const result = await organizationMemberRoleRepository.changeRoleWithAuditLog({ ...input, targetMembershipId: 1, newRole: 'ADMIN' }, allow)

    expect(result.status).toBe(memberRoleChangeResults.changed)
    expect(allow).toHaveBeenCalledWith({ operatorRole: 'OWNER', targetRole: 'OWNER' })
  })

  test('Organization行が取得できなければORGANIZATION_NOT_FOUNDを返し、以降のロックも書き込みもしない', async () => {
    queryRaw.mockResolvedValueOnce([])

    const result = await organizationMemberRoleRepository.changeRoleWithAuditLog(input, allow)

    expect(result).toEqual({ status: memberRoleChangeResults.organizationNotFound })
    expect(queryRaw).toHaveBeenCalledTimes(1)
    expect(allow).not.toHaveBeenCalled()
    expect(updateMany).not.toHaveBeenCalled()
    expect(auditLogCreate).not.toHaveBeenCalled()
  })

  test('操作者のMembershipが消えていればORGANIZATION_NOT_FOUNDを返す', async () => {
    prepareRoleChangeLocks([targetRow])

    const result = await organizationMemberRoleRepository.changeRoleWithAuditLog(input, allow)

    expect(result).toEqual({ status: memberRoleChangeResults.organizationNotFound })
    expect(allow).not.toHaveBeenCalled()
    expect(updateMany).not.toHaveBeenCalled()
    expect(auditLogCreate).not.toHaveBeenCalled()
  })

  test('対象が存在しない、または別組織でロック対象に入らなければTARGET_NOT_FOUNDを返す', async () => {
    // 別組織の対象はWHERE句の組織条件で除外されるため、操作者の行だけが返る
    prepareRoleChangeLocks([operatorRow])

    const result = await organizationMemberRoleRepository.changeRoleWithAuditLog(input, allow)

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

    const result = await organizationMemberRoleRepository.changeRoleWithAuditLog(input, deny)

    expect(result).toEqual({ status: memberRoleChangeResults.rejected, rejection: '拒否' })
    expect(deny).toHaveBeenCalledWith({ operatorRole: 'ADMIN', targetRole: 'ADMIN' })
    expect(updateMany).not.toHaveBeenCalled()
    expect(auditLogCreate).not.toHaveBeenCalled()
  })

  test('現在のロールと同じ指定ならUNCHANGEDで現在のmembershipを返し、更新も記録もしない', async () => {
    prepareRoleChangeLocks()

    const result = await organizationMemberRoleRepository.changeRoleWithAuditLog({ ...input, newRole: 'MEMBER' }, allow)

    expect(result).toEqual({ status: memberRoleChangeResults.unchanged, membership: targetRow })
    expect(updateMany).not.toHaveBeenCalled()
    expect(auditLogCreate).not.toHaveBeenCalled()
  })

  test('条件付き更新が0件ならtransactionを失敗させてCONFLICTを返し、記録しない', async () => {
    prepareRoleChangeLocks()
    updateMany.mockResolvedValueOnce({ count: 0 })

    const result = await organizationMemberRoleRepository.changeRoleWithAuditLog(input, allow)

    expect(result).toEqual({ status: memberRoleChangeResults.conflict })
    expect(auditLogCreate).not.toHaveBeenCalled()
  })

  test('監査ログの追加に失敗したらそのままthrowし、transactionをrollbackさせる', async () => {
    prepareRoleChangeLocks()
    updateMany.mockResolvedValueOnce({ count: 1 })
    auditLogCreate.mockRejectedValueOnce(new Error('INSERT失敗'))

    await expect(organizationMemberRoleRepository.changeRoleWithAuditLog(input, allow)).rejects.toThrow('INSERT失敗')
  })

  test('予期しないDBエラーはそのままthrowする', async () => {
    queryRaw.mockRejectedValueOnce(new Error('接続エラー'))

    await expect(organizationMemberRoleRepository.changeRoleWithAuditLog(input, allow)).rejects.toThrow('接続エラー')
  })
})

describe('organizationMembershipRepository.leave', () => {
  beforeEach(() => {
    deleteMany.mockReset()
    findUnique.mockReset()
  })

  test('認証ユーザー自身のOWNER以外のmembershipを条件付きで削除する', async () => {
    deleteMany.mockResolvedValue({ count: 1 })

    const result = await organizationMembershipRepository.leave(1, 2)

    expect(result).toBe(leaveOrganizationResults.left)
    expect(deleteMany).toHaveBeenCalledWith({
      where: { organizationId: 1, userId: 2, role: { not: 'OWNER' } },
    })
    expect(findUnique).not.toHaveBeenCalled()
  })

  test('条件付き削除が0件で最新ロールがOWNERならOWNERを返す', async () => {
    deleteMany.mockResolvedValue({ count: 0 })
    findUnique.mockResolvedValue({ role: 'OWNER' })

    const result = await organizationMembershipRepository.leave(1, 2)

    expect(result).toBe(leaveOrganizationResults.owner)
    expect(deleteMany).toHaveBeenCalledTimes(1)
  })

  test('条件付き削除が0件でmembershipがなければNOT_MEMBERを返す', async () => {
    deleteMany.mockResolvedValue({ count: 0 })
    findUnique.mockResolvedValue(null)

    const result = await organizationMembershipRepository.leave(1, 2)

    expect(result).toBe(leaveOrganizationResults.notMember)
    expect(findUnique).toHaveBeenCalledWith({
      where: { userId_organizationId: { userId: 2, organizationId: 1 } },
      select: { role: true },
    })
  })

  test('競合後の最新ロールがADMINまたはMEMBERなら条件付き削除を再試行する', async () => {
    deleteMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 })
    findUnique.mockResolvedValue({ role: 'ADMIN' })

    const result = await organizationMembershipRepository.leave(1, 2)

    expect(result).toBe(leaveOrganizationResults.left)
    expect(deleteMany).toHaveBeenCalledTimes(2)
    expect(findUnique).toHaveBeenCalledTimes(1)
  })

  test('再試行後も削除できず最新ロールがOWNER以外ならCONFLICTを返す', async () => {
    deleteMany.mockResolvedValue({ count: 0 })
    findUnique.mockResolvedValue({ role: 'MEMBER' })

    const result = await organizationMembershipRepository.leave(1, 2)

    expect(result).toBe(leaveOrganizationResults.conflict)
    expect(deleteMany).toHaveBeenCalledTimes(2)
    expect(findUnique).toHaveBeenCalledTimes(2)
  })

  test('予期しないDBエラーはそのままthrowする', async () => {
    deleteMany.mockRejectedValue(new Error('接続エラー'))

    await expect(organizationMembershipRepository.leave(1, 2)).rejects.toThrow('接続エラー')
  })
})
