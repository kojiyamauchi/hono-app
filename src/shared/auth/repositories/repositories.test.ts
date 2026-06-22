import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { PasswordResetToken, RefreshToken } from '@/shared/auth/entities'

const create = mock()
const findUnique = mock()
const updateMany = mock()
const transactionCreate = mock()
const transactionUpdateMany = mock()
const prtTransactionCreate = mock()
const prtTransactionFindUnique = mock()
const prtTransactionUpdateMany = mock()
const userTransactionUpdate = mock()
const transaction = mock(async (callback: (tx: unknown) => Promise<unknown>) =>
  callback({
    refreshToken: { create: transactionCreate, updateMany: transactionUpdateMany },
    passwordResetToken: {
      create: prtTransactionCreate,
      findUnique: prtTransactionFindUnique,
      updateMany: prtTransactionUpdateMany,
    },
    user: { update: userTransactionUpdate },
  }),
)
const prtCreate = mock()
const prtFindUnique = mock()
const prtUpdateMany = mock()
const prtDelete = mock()

await mock.module('@/libs/prisma', () => ({
  prisma: {
    refreshToken: { create, findUnique, updateMany },
    passwordResetToken: {
      create: prtCreate,
      findUnique: prtFindUnique,
      updateMany: prtUpdateMany,
      delete: prtDelete,
    },
    $transaction: transaction,
  },
}))

const { passwordResetTokenRepository, refreshTokenRepository } = await import('.')

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
const passwordResetToken: PasswordResetToken = {
  id: 20,
  userId: 1,
  tokenHash: 'reset-token-hash',
  expiresAt,
  usedAt: null,
  createdAt,
}

beforeEach(() => {
  create.mockReset()
  findUnique.mockReset()
  updateMany.mockReset()
  transaction.mockClear()
  transactionCreate.mockReset()
  transactionUpdateMany.mockReset()
  prtTransactionCreate.mockReset()
  prtTransactionFindUnique.mockReset()
  prtTransactionUpdateMany.mockReset()
  userTransactionUpdate.mockReset()
  prtCreate.mockReset()
  prtFindUnique.mockReset()
  prtUpdateMany.mockReset()
  prtDelete.mockReset()
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

  test('revokeAllByUserId: 指定ユーザーの全未失効リフレッシュトークンを失効させる', async () => {
    updateMany.mockResolvedValue({ count: 3 })

    await expect(refreshTokenRepository.revokeAllByUserId(1)).resolves.toBe(3)
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 1, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    })
  })
})

describe('passwordResetTokenRepository', () => {
  test('createでトークンを作成し、旧未使用トークンを無効化する', async () => {
    prtTransactionUpdateMany.mockResolvedValue({ count: 1 })
    prtTransactionCreate.mockResolvedValue(passwordResetToken)

    const result = await passwordResetTokenRepository.create(1, 'reset-token-hash', expiresAt)

    expect(result).toEqual(passwordResetToken)
    expect(transaction).toHaveBeenCalledTimes(1)
    // 旧トークンを無効化してから新規作成する
    expect(prtTransactionUpdateMany).toHaveBeenCalledWith({
      where: { userId: 1, usedAt: null },
      data: { usedAt: expect.any(Date) },
    })
    expect(prtTransactionCreate).toHaveBeenCalledWith({
      data: { userId: 1, tokenHash: 'reset-token-hash', expiresAt },
    })
  })

  test('findByTokenHashでトークンを取得する', async () => {
    prtFindUnique.mockResolvedValue(passwordResetToken)

    await expect(passwordResetTokenRepository.findByTokenHash('reset-token-hash')).resolves.toEqual(passwordResetToken)
    expect(prtFindUnique).toHaveBeenCalledWith({ where: { tokenHash: 'reset-token-hash' } })
  })

  test('findByTokenHashで存在しない場合はnullを返す', async () => {
    prtFindUnique.mockResolvedValue(null)

    await expect(passwordResetTokenRepository.findByTokenHash('unknown-hash')).resolves.toBeNull()
  })

  test('deleteByIdでトークンを削除する', async () => {
    prtDelete.mockResolvedValue(passwordResetToken)

    await expect(passwordResetTokenRepository.deleteById(20)).resolves.toBeUndefined()
    expect(prtDelete).toHaveBeenCalledWith({ where: { id: 20 } })
  })

  test('confirmで未使用トークンを消費し、パスワード更新・全refresh失効を原子的に行う', async () => {
    prtTransactionUpdateMany.mockResolvedValue({ count: 1 })
    userTransactionUpdate.mockResolvedValue({})
    transactionUpdateMany.mockResolvedValue({ count: 2 })

    const result = await passwordResetTokenRepository.confirm(20, 1, 'new-hashed-password')

    expect(result).toBe(true)
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(prtTransactionUpdateMany).toHaveBeenCalledWith({
      where: { id: 20, usedAt: null },
      data: { usedAt: expect.any(Date) },
    })
    expect(userTransactionUpdate).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { password: 'new-hashed-password' },
    })
    expect(transactionUpdateMany).toHaveBeenCalledWith({
      where: { userId: 1, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    })
  })

  test('confirmで既に消費済みのトークンの場合はfalseを返す', async () => {
    prtTransactionUpdateMany.mockResolvedValue({ count: 0 })

    const result = await passwordResetTokenRepository.confirm(20, 1, 'new-hashed-password')

    expect(result).toBe(false)
    // パスワード更新・refresh失効は実行しない
    expect(userTransactionUpdate).not.toHaveBeenCalled()
    expect(transactionUpdateMany).not.toHaveBeenCalled()
  })
})
