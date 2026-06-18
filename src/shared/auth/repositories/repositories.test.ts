import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { RefreshToken } from '@/shared/auth/entities'

const create = mock()
const findUnique = mock()
const updateMany = mock()
const transactionCreate = mock()
const transactionUpdateMany = mock()
const transaction = mock(async (callback: (tx: unknown) => Promise<unknown>) =>
  callback({ refreshToken: { create: transactionCreate, updateMany: transactionUpdateMany } }),
)

await mock.module('@/libs/prisma', () => ({
  prisma: {
    refreshToken: { create, findUnique, updateMany },
    $transaction: transaction,
  },
}))

const { refreshTokenRepository } = await import('.')

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
})
