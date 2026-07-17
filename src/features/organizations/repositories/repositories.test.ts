import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { Role } from '@/shared/membership/entities'

const queryRaw = mock()
const updateMany = mock()
const transaction = mock()

await mock.module('@/libs/prisma', () => ({
  prisma: { $transaction: transaction },
}))

const { organizationOwnershipRepository, ownershipTransferResults } = await import('.')

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
  transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({ $queryRaw: queryRaw, membership: { updateMany } }))
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
