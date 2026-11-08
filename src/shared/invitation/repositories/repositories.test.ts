import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { Prisma } from '@/generated/prisma/client'
import type { Membership } from '@/shared/membership/entities'
import type { User } from '@/shared/user/entities'

const queryRaw = mock()
const invitationUpdateMany = mock()
const membershipCreate = mock()
const userCreate = mock()
const transaction = mock()

await mock.module('@/libs/prisma', () => ({
  prisma: { $transaction: transaction },
}))

const { invitationRepository } = await import('.')

const membership: Membership = { id: 5, userId: 2, organizationId: 1, role: 'MEMBER', createdAt: new Date('2026-01-01T00:00:00.000Z') }
const user: User = {
  id: 2,
  name: 'User',
  email: 'invite@example.com',
  password: 'hash',
  emailVerifiedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

/** tagged templateで呼ばれた$queryRawのSQL文字列と埋め込み値を取り出す。 */
const queryOf = (callIndex: number): { sql: string; values: unknown[] } => {
  const [strings, ...values] = queryRaw.mock.calls[callIndex] as [string[], ...unknown[]]
  return { sql: strings.join('?').replace(/\s+/g, ' ').trim(), values }
}

beforeEach(() => {
  queryRaw.mockReset()
  invitationUpdateMany.mockReset()
  membershipCreate.mockReset()
  userCreate.mockReset()
  transaction.mockReset()
  transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      $queryRaw: queryRaw,
      invitation: { updateMany: invitationUpdateMany },
      membership: { create: membershipCreate },
      user: { create: userCreate },
    }),
  )
})

describe('invitationRepository.accept', () => {
  test('招待を更新する前にOrganization行をFOR KEY SHAREで確保し、メンバーシップを作成する', async () => {
    const callOrder: string[] = []
    queryRaw.mockImplementation(async () => {
      callOrder.push('organization-lock')
      return [{ id: 1 }]
    })
    invitationUpdateMany.mockImplementation(async () => {
      callOrder.push('invitation-update')
      return { count: 1 }
    })
    membershipCreate.mockImplementation(async () => {
      callOrder.push('membership-create')
      return membership
    })

    const result = await invitationRepository.accept(20, 1, 2, 'MEMBER')

    expect(result).toEqual(membership)
    expect(callOrder).toEqual(['organization-lock', 'invitation-update', 'membership-create'])
    expect(queryOf(0).sql).toContain('FROM "Organization" WHERE id = ? FOR KEY SHARE')
    expect(queryOf(0).values).toEqual([1])
    expect(invitationUpdateMany).toHaveBeenCalledWith({ where: { id: 20, status: 'PENDING' }, data: { status: 'ACCEPTED' } })
  })

  test('組織が先に削除されていれば、招待を更新せず競合結果のnullを返す', async () => {
    queryRaw.mockResolvedValue([])

    const result = await invitationRepository.accept(20, 1, 2, 'MEMBER')

    expect(result).toBeNull()
    expect(invitationUpdateMany).not.toHaveBeenCalled()
    expect(membershipCreate).not.toHaveBeenCalled()
  })

  test('招待がPENDINGでなければnullを返し、メンバーシップを作成しない', async () => {
    queryRaw.mockResolvedValue([{ id: 1 }])
    invitationUpdateMany.mockResolvedValue({ count: 0 })

    const result = await invitationRepository.accept(20, 1, 2, 'MEMBER')

    expect(result).toBeNull()
    expect(membershipCreate).not.toHaveBeenCalled()
  })

  test('一意制約違反はnullへ変換し、それ以外のエラーはそのままthrowする', async () => {
    queryRaw.mockResolvedValue([{ id: 1 }])
    invitationUpdateMany.mockResolvedValue({ count: 1 })
    membershipCreate.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('重複', { code: 'P2002', clientVersion: 'test' }))

    expect(await invitationRepository.accept(20, 1, 2, 'MEMBER')).toBeNull()

    membershipCreate.mockRejectedValueOnce(new Error('接続エラー'))

    await expect(invitationRepository.accept(20, 1, 2, 'MEMBER')).rejects.toThrow('接続エラー')
  })
})

describe('invitationRepository.signup', () => {
  test('招待を更新する前にOrganization行をFOR KEY SHAREで確保し、ユーザーとメンバーシップを作成する', async () => {
    const callOrder: string[] = []
    queryRaw.mockImplementation(async () => {
      callOrder.push('organization-lock')
      return [{ id: 1 }]
    })
    invitationUpdateMany.mockImplementation(async () => {
      callOrder.push('invitation-update')
      return { count: 1 }
    })
    userCreate.mockImplementation(async () => {
      callOrder.push('user-create')
      return user
    })
    membershipCreate.mockImplementation(async () => {
      callOrder.push('membership-create')
      return membership
    })

    const result = await invitationRepository.signup(20, 1, 'invite@example.com', 'User', 'hash', 'MEMBER')

    expect(result).toEqual(user)
    expect(callOrder).toEqual(['organization-lock', 'invitation-update', 'user-create', 'membership-create'])
    expect(queryOf(0).sql).toContain('FROM "Organization" WHERE id = ? FOR KEY SHARE')
    expect(queryOf(0).values).toEqual([1])
  })

  test('組織が先に削除されていれば、招待もユーザーも作らず競合結果のnullを返す', async () => {
    queryRaw.mockResolvedValue([])

    const result = await invitationRepository.signup(20, 1, 'invite@example.com', 'User', 'hash', 'MEMBER')

    expect(result).toBeNull()
    expect(invitationUpdateMany).not.toHaveBeenCalled()
    expect(userCreate).not.toHaveBeenCalled()
    expect(membershipCreate).not.toHaveBeenCalled()
  })

  test('招待がPENDINGでなければnullを返し、ユーザーを作成しない', async () => {
    queryRaw.mockResolvedValue([{ id: 1 }])
    invitationUpdateMany.mockResolvedValue({ count: 0 })

    const result = await invitationRepository.signup(20, 1, 'invite@example.com', 'User', 'hash', 'MEMBER')

    expect(result).toBeNull()
    expect(userCreate).not.toHaveBeenCalled()
  })
})
