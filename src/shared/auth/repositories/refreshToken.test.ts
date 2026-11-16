import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { RefreshToken } from '@/shared/auth/entities/refreshToken'

const create = mock()
const findUnique = mock()
const findMany = mock()
const groupBy = mock()
const updateMany = mock()
const transactionCreate = mock()
const transactionUpdateMany = mock()
const transaction = mock(async (callback: (tx: unknown) => Promise<unknown>) =>
  callback({
    refreshToken: { create: transactionCreate, updateMany: transactionUpdateMany },
  }),
)

await mock.module('@/libs/prisma', () => ({
  prisma: {
    refreshToken: { create, findUnique, findMany, groupBy, updateMany },
    $transaction: transaction,
  },
}))

const { refreshTokenRepository } = await import('./refreshToken')

const expiresAt = new Date('2026-07-01T00:00:00.000Z')
const createdAt = new Date('2026-06-18T00:00:00.000Z')
const input = {
  userId: 1,
  familyId: 'family-id',
  tokenHash: 'token-hash',
  expiresAt,
}
const refreshToken: RefreshToken = {
  id: 10,
  ...input,
  revokedAt: null,
  createdAt,
}

beforeEach(() => {
  create.mockReset()
  findUnique.mockReset()
  findMany.mockReset()
  groupBy.mockReset()
  updateMany.mockReset()
  transaction.mockClear()
  transactionCreate.mockReset()
  transactionUpdateMany.mockReset()
})

describe('refreshTokenRepository', () => {
  test('リフレッシュトークンを作成する', async () => {
    create.mockResolvedValue(refreshToken)

    await expect(refreshTokenRepository.create(input)).resolves.toEqual(refreshToken)
    expect(create).toHaveBeenCalledWith({ data: input })
  })

  test('ハッシュ値でリフレッシュトークンを取得する', async () => {
    findUnique.mockResolvedValue(refreshToken)

    await expect(refreshTokenRepository.findByTokenHash('token-hash')).resolves.toEqual(refreshToken)
    expect(findUnique).toHaveBeenCalledWith({ where: { tokenHash: 'token-hash' } })
  })

  test('有効なトークンをIDで失効させる', async () => {
    updateMany.mockResolvedValue({ count: 1 })

    await expect(refreshTokenRepository.revokeById(10)).resolves.toBe(true)
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 10, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    })
  })

  test('同じfamilyの有効なトークンを全て失効させる', async () => {
    updateMany.mockResolvedValue({ count: 2 })

    await expect(refreshTokenRepository.revokeFamily('family-id')).resolves.toBe(2)
    expect(updateMany).toHaveBeenCalledWith({
      where: { familyId: 'family-id', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    })
  })

  test('revokeByUserIdAndFamilyId: userIdとfamilyIdの両方に一致する未失効トークンのみ失効させる', async () => {
    updateMany.mockResolvedValue({ count: 1 })

    await expect(refreshTokenRepository.revokeByUserIdAndFamilyId(1, 'family-id')).resolves.toBe(1)
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 1, familyId: 'family-id', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    })
  })

  test('revokeByUserIdAndFamilyId: 対象が無ければ0件を返す', async () => {
    updateMany.mockResolvedValue({ count: 0 })

    await expect(refreshTokenRepository.revokeByUserIdAndFamilyId(2, 'family-id')).resolves.toBe(0)
  })

  test('旧トークンの失効と新トークン作成を同一トランザクションで行う', async () => {
    const nextToken = { ...refreshToken, id: 11, tokenHash: 'next-token-hash' }
    transactionUpdateMany.mockResolvedValue({ count: 1 })
    transactionCreate.mockResolvedValue(nextToken)

    await expect(refreshTokenRepository.rotate(10, { ...input, tokenHash: 'next-token-hash' })).resolves.toEqual({
      status: 'ROTATED',
      refreshToken: nextToken,
    })
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(transactionCreate).toHaveBeenCalledWith({ data: { ...input, tokenHash: 'next-token-hash' } })
  })

  test('旧トークンが既に失効済みならfamilyを失効して再利用を返す', async () => {
    transactionUpdateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 })

    await expect(refreshTokenRepository.rotate(10, input)).resolves.toEqual({ status: 'REUSED' })
    expect(transactionUpdateMany).toHaveBeenNthCalledWith(2, {
      where: { familyId: 'family-id', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    })
    expect(transactionCreate).not.toHaveBeenCalled()
  })

  test('revokeAllByUserId: 指定ユーザーの全未失効リフレッシュトークンを失効させる', async () => {
    updateMany.mockResolvedValue({ count: 3 })

    await expect(refreshTokenRepository.revokeAllByUserId(1)).resolves.toBe(3)
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 1, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    })
  })

  test('findActiveSessionsByUserId: 指定ユーザーの未失効・未期限切れセッションのみ取得すること', async () => {
    const activeCreatedAt = new Date('2026-06-20T00:00:00.000Z')
    const activeExpiresAt = new Date('2026-07-01T00:00:00.000Z')

    findMany.mockResolvedValue([{ familyId: 'family-1', expiresAt: activeExpiresAt, createdAt: activeCreatedAt }])
    groupBy.mockResolvedValue([{ familyId: 'family-1', _min: { createdAt: new Date('2026-06-01T00:00:00.000Z') } }])

    await refreshTokenRepository.findActiveSessionsByUserId(1)

    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 1, revokedAt: null, expiresAt: { gt: expect.any(Date) } },
      select: { familyId: true, expiresAt: true, createdAt: true },
    })
    // familyIdはschema上uniqueではないため、集約側もuserIdで絞り別ユーザーのcreatedAt混入を防ぐ
    expect(groupBy).toHaveBeenCalledWith({
      by: ['familyId'],
      where: { userId: 1, familyId: { in: ['family-1'] } },
      _min: { createdAt: true },
    })
  })

  test('findActiveSessionsByUserId: familyIdごとに1セッションとして返すこと', async () => {
    const now = new Date()
    const expiresAt1 = new Date(now.getTime() + 60_000)
    const expiresAt2 = new Date(now.getTime() + 120_000)
    const createdAt1 = new Date('2026-06-20T00:00:00.000Z')
    const createdAt2 = new Date('2026-06-21T00:00:00.000Z')

    findMany.mockResolvedValue([
      { familyId: 'family-1', expiresAt: expiresAt1, createdAt: createdAt1 },
      { familyId: 'family-2', expiresAt: expiresAt2, createdAt: createdAt2 },
    ])
    groupBy.mockResolvedValue([
      { familyId: 'family-1', _min: { createdAt: createdAt1 } },
      { familyId: 'family-2', _min: { createdAt: createdAt2 } },
    ])

    const sessions = await refreshTokenRepository.findActiveSessionsByUserId(1)

    expect(sessions).toHaveLength(2)
    expect(sessions[0].familyId).toBe('family-1')
    expect(sessions[1].familyId).toBe('family-2')
  })

  test('findActiveSessionsByUserId: createdAtがactive行ではなくgroupByの_min.createdAtになること', async () => {
    const sessionCreatedAt = new Date('2026-06-20T00:00:00.000Z')
    const familyStartedAt = new Date('2026-06-01T00:00:00.000Z') // 最初のトークン発行日

    findMany.mockResolvedValue([{ familyId: 'family-1', expiresAt: new Date('2026-07-01T00:00:00.000Z'), createdAt: sessionCreatedAt }])
    groupBy.mockResolvedValue([{ familyId: 'family-1', _min: { createdAt: familyStartedAt } }])

    const sessions = await refreshTokenRepository.findActiveSessionsByUserId(1)

    expect(sessions).toHaveLength(1)
    // セッション開始日時はfamilyの最初のcreatedAt（groupByの結果）
    expect(sessions[0].createdAt).toEqual(familyStartedAt)
    // lastUsedAtはactive行のcreatedAt（最後にrefresh tokenが発行された時刻）
    expect(sessions[0].lastUsedAt).toEqual(sessionCreatedAt)
  })

  test('findActiveSessionsByUserId: 同一family内にrevoked行があっても開始日時が最初のcreatedAtになること', async () => {
    // active行は現在のトークン（2026-06-20発行）
    const activeCreatedAt = new Date('2026-06-20T00:00:00.000Z')
    // familyの最初のトークンはrevoked行（2026-06-01発行）
    const originalCreatedAt = new Date('2026-06-01T00:00:00.000Z')

    findMany.mockResolvedValue([{ familyId: 'family-1', expiresAt: new Date('2026-07-01T00:00:00.000Z'), createdAt: activeCreatedAt }])
    // groupByはrevoked行を含むため、family内の最初のcreatedAt（古い日付）を返す
    groupBy.mockResolvedValue([{ familyId: 'family-1', _min: { createdAt: originalCreatedAt } }])

    const sessions = await refreshTokenRepository.findActiveSessionsByUserId(1)

    expect(sessions[0].createdAt).toEqual(originalCreatedAt)
    // lastUsedAtはactive行のcreatedAt
    expect(sessions[0].lastUsedAt).toEqual(activeCreatedAt)
  })

  test('findActiveSessionsByUserId: active行が0件なら空配列を返し、groupByを呼ばないこと', async () => {
    findMany.mockResolvedValue([])

    const sessions = await refreshTokenRepository.findActiveSessionsByUserId(1)

    expect(sessions).toEqual([])
    expect(groupBy).not.toHaveBeenCalled()
  })

  test('findActiveSessionsByUserId: familyあたりactive行1件の前提で、セッション数=family数になること', async () => {
    const now = new Date()
    const expiresAt = new Date(now.getTime() + 60_000)
    const createdAt = new Date('2026-06-18T00:00:00.000Z')

    findMany.mockResolvedValue([
      { familyId: 'family-A', expiresAt, createdAt },
      { familyId: 'family-B', expiresAt, createdAt },
      { familyId: 'family-C', expiresAt, createdAt },
    ])
    groupBy.mockResolvedValue([
      { familyId: 'family-A', _min: { createdAt } },
      { familyId: 'family-B', _min: { createdAt } },
      { familyId: 'family-C', _min: { createdAt } },
    ])

    const sessions = await refreshTokenRepository.findActiveSessionsByUserId(1)

    expect(sessions).toHaveLength(3)
    const ids = sessions.map((s) => s.familyId)
    expect(ids).toContain('family-A')
    expect(ids).toContain('family-B')
    expect(ids).toContain('family-C')
  })
})
