import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { Organization } from '@/shared/organization/entities'

const queryRaw = mock()
const organizationCreate = mock()
const membershipCreate = mock()
const transaction = mock(async (callback: (tx: unknown) => Promise<unknown>) =>
  callback({
    $queryRaw: queryRaw,
    organization: { create: organizationCreate },
    membership: { create: membershipCreate },
  }),
)

await mock.module('@/libs/prisma', () => ({
  prisma: { $transaction: transaction },
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
