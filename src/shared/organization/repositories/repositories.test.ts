import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { Organization } from '@/shared/organization/entities'

const queryRaw = mock()
const organizationCreate = mock()
const membershipCreate = mock()
const organizationFindMany = mock()
const organizationDelete = mock()
const membershipDeleteMany = mock()
const invitationDeleteMany = mock()
const transaction = mock(async (callback: (tx: unknown) => Promise<unknown>) =>
  callback({
    $queryRaw: queryRaw,
    organization: { create: organizationCreate, delete: organizationDelete },
    membership: { create: membershipCreate, deleteMany: membershipDeleteMany },
    invitation: { deleteMany: invitationDeleteMany },
  }),
)

await mock.module('@/libs/prisma', () => ({
  prisma: { $transaction: transaction, organization: { findMany: organizationFindMany } },
}))

const { organizationRepository } = await import('.')

const organization: Organization = {
  id: 1,
  name: 'Acme',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

describe('organizationRepository.createWithOwner', () => {
  beforeEach(() => {
    queryRaw.mockReset()
    organizationCreate.mockReset()
    membershipCreate.mockReset()
    transaction.mockClear()
  })

  test('作成者User行をロックしてから組織とOWNERメンバーシップを作成する', async () => {
    const callOrder: string[] = []
    queryRaw.mockImplementation(async () => {
      callOrder.push('user-lock')
      return [{ id: 1 }]
    })
    organizationCreate.mockImplementation(async () => {
      callOrder.push('organization-create')
      return organization
    })
    membershipCreate.mockImplementation(async () => {
      callOrder.push('membership-create')
      return undefined
    })

    const result = await organizationRepository.createWithOwner('Acme', 1)

    expect(result).toEqual(organization)
    expect(callOrder).toEqual(['user-lock', 'organization-create', 'membership-create'])
    expect(organizationCreate).toHaveBeenCalledWith({ data: { name: 'Acme' } })
    expect(membershipCreate).toHaveBeenCalledWith({ data: { userId: 1, organizationId: 1, role: 'OWNER' } })
  })

  test('作成者が存在しない場合は組織を作成しない', async () => {
    queryRaw.mockResolvedValue([])

    await expect(organizationRepository.createWithOwner('Acme', 999)).rejects.toThrow('組織の作成者が見つかりません')

    expect(organizationCreate).not.toHaveBeenCalled()
    expect(membershipCreate).not.toHaveBeenCalled()
  })
})

describe('organizationRepository.findPageByUserId', () => {
  beforeEach(() => {
    organizationFindMany.mockReset()
  })

  test('所属条件・ID昇順・skip・takeをPrismaへ渡し、結果をそのまま返す', async () => {
    organizationFindMany.mockResolvedValue([organization])

    const result = await organizationRepository.findPageByUserId(10, 21, 40)

    expect(result).toEqual([organization])
    expect(organizationFindMany).toHaveBeenCalledWith({
      where: { memberships: { some: { userId: 10 } } },
      orderBy: { id: 'asc' },
      skip: 40,
      take: 21,
    })
  })
})

describe('organizationRepository.deleteById', () => {
  beforeEach(() => {
    queryRaw.mockReset()
    organizationDelete.mockReset()
    membershipDeleteMany.mockReset()
    invitationDeleteMany.mockReset()
    transaction.mockClear()
  })

  test('Organization行をFOR UPDATEでロックしてから、招待・メンバーシップ・組織の順に削除する', async () => {
    const callOrder: string[] = []
    queryRaw.mockImplementation(async (strings: string[], ...values: unknown[]) => {
      callOrder.push('organization-lock')
      expect(strings.join('?').replace(/\s+/g, ' ')).toContain('FROM "Organization" WHERE id = ? FOR UPDATE')
      expect(values).toEqual([1])
      return [{ id: 1 }]
    })
    invitationDeleteMany.mockImplementation(async () => {
      callOrder.push('invitation-delete')
      return { count: 0 }
    })
    membershipDeleteMany.mockImplementation(async () => {
      callOrder.push('membership-delete')
      return { count: 1 }
    })
    organizationDelete.mockImplementation(async () => {
      callOrder.push('organization-delete')
      return organization
    })

    const result = await organizationRepository.deleteById(1)

    expect(result).toBe(true)
    expect(callOrder).toEqual(['organization-lock', 'invitation-delete', 'membership-delete', 'organization-delete'])
    expect(invitationDeleteMany).toHaveBeenCalledWith({ where: { organizationId: 1 } })
    expect(membershipDeleteMany).toHaveBeenCalledWith({ where: { organizationId: 1 } })
    expect(organizationDelete).toHaveBeenCalledWith({ where: { id: 1 } })
  })

  test('ロックで組織が取得できなければ何も削除せずfalseを返す', async () => {
    queryRaw.mockResolvedValue([])

    const result = await organizationRepository.deleteById(999)

    expect(result).toBe(false)
    expect(invitationDeleteMany).not.toHaveBeenCalled()
    expect(membershipDeleteMany).not.toHaveBeenCalled()
    expect(organizationDelete).not.toHaveBeenCalled()
  })

  test('削除中のエラーはそのままthrowする', async () => {
    queryRaw.mockResolvedValue([{ id: 1 }])
    invitationDeleteMany.mockRejectedValue(new Error('削除エラー'))

    await expect(organizationRepository.deleteById(1)).rejects.toThrow('削除エラー')
  })
})
