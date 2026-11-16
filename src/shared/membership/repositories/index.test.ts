import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { Prisma } from '@/generated/prisma/client'

const queryRaw = mock()

await mock.module('@/libs/prisma', () => ({
  prisma: { $queryRaw: queryRaw },
}))

const { membershipRepository } = await import('.')

/** $queryRaw に渡された Prisma.Sql を取り出す。 */
const getIssuedSql = (): Prisma.Sql => queryRaw.mock.calls[0]?.[0] as Prisma.Sql

describe('membershipRepository.findPageByOrganization', () => {
  beforeEach(() => {
    queryRaw.mockReset()
  })

  test('境界値がない場合は組織IDとtakeだけをバインドし、境界条件を含めない', async () => {
    queryRaw.mockResolvedValue([])

    await membershipRepository.findPageByOrganization(2, 21, null)

    const sql = getIssuedSql()
    expect(sql.values).toEqual([2, 21])
    expect(sql.sql).not.toContain('>')
  })

  test('境界値がある場合は組織ID・境界値・takeをこの順でバインドする', async () => {
    queryRaw.mockResolvedValue([])
    const createdAt = new Date('2026-01-01T00:00:00.000Z')

    await membershipRepository.findPageByOrganization(2, 21, { createdAt, id: 5 })

    const sql = getIssuedSql()
    expect(sql.values).toEqual([2, createdAt, 5, 21])
    expect(sql.sql).toContain('("createdAt", id) > (')
  })

  test('取得した行をMembershipエンティティへ変換する', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z')
    queryRaw.mockResolvedValue([{ id: 1, userId: 10, organizationId: 2, role: 'ADMIN', createdAt }])

    const result = await membershipRepository.findPageByOrganization(2, 21, null)

    expect(result).toEqual([{ id: 1, userId: 10, organizationId: 2, role: 'ADMIN', createdAt }])
  })
})
