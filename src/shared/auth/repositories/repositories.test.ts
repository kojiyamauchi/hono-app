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
const prtTransactionDeleteMany = mock()
const userTransactionUpdate = mock()
const userTransactionUpdateMany = mock()
const transaction = mock(async (callback: (tx: unknown) => Promise<unknown>) =>
  callback({
    refreshToken: { create: transactionCreate, updateMany: transactionUpdateMany },
    passwordResetToken: {
      create: prtTransactionCreate,
      findUnique: prtTransactionFindUnique,
      updateMany: prtTransactionUpdateMany,
      deleteMany: prtTransactionDeleteMany,
    },
    user: { update: userTransactionUpdate, updateMany: userTransactionUpdateMany },
  }),
)
const prtCreate = mock()
const prtFindUnique = mock()
const prtUpdateMany = mock()
const prtDelete = mock()
const prtDeleteMany = mock()
const prtUpsert = mock()

await mock.module('@/libs/prisma', () => ({
  prisma: {
    refreshToken: { create, findUnique, updateMany },
    passwordResetToken: {
      create: prtCreate,
      findUnique: prtFindUnique,
      updateMany: prtUpdateMany,
      delete: prtDelete,
      deleteMany: prtDeleteMany,
      upsert: prtUpsert,
    },
    $transaction: transaction,
  },
}))

const { authCredentialRepository, passwordResetTokenRepository, refreshTokenRepository } = await import('.')

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
  prtTransactionDeleteMany.mockReset()
  userTransactionUpdate.mockReset()
  userTransactionUpdateMany.mockReset()
  prtCreate.mockReset()
  prtFindUnique.mockReset()
  prtUpdateMany.mockReset()
  prtDelete.mockReset()
  prtDeleteMany.mockReset()
  prtUpsert.mockReset()
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

describe('authCredentialRepository', () => {
  test('changePasswordでパスワード更新と全refresh失効を原子的に行う', async () => {
    userTransactionUpdateMany.mockResolvedValue({ count: 1 })
    transactionUpdateMany.mockResolvedValue({ count: 2 })

    const result = await authCredentialRepository.changePassword(1, 'new-hashed-password')

    expect(result).toBe(true)
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(userTransactionUpdateMany).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { password: 'new-hashed-password' },
    })
    expect(transactionUpdateMany).toHaveBeenCalledWith({
      where: { userId: 1, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    })
  })

  test('changePasswordで対象ユーザーが存在しない場合はfalseを返しrefresh失効しない', async () => {
    userTransactionUpdateMany.mockResolvedValue({ count: 0 })

    const result = await authCredentialRepository.changePassword(1, 'new-hashed-password')

    expect(result).toBe(false)
    expect(transactionUpdateMany).not.toHaveBeenCalled()
  })
})

describe('passwordResetTokenRepository', () => {
  test('createはuserId一意のupsertで1ユーザー1行に保つ（並行requestでも増えない）', async () => {
    prtUpsert.mockResolvedValue(passwordResetToken)

    const result = await passwordResetTokenRepository.create(1, 'reset-token-hash', expiresAt)

    expect(result).toEqual(passwordResetToken)
    // userId をconflict keyにしたupsert（PostgreSQLでINSERT ... ON CONFLICT DO UPDATEに展開され原子的）
    expect(prtUpsert).toHaveBeenCalledWith({
      where: { userId: 1 },
      create: { userId: 1, tokenHash: 'reset-token-hash', expiresAt },
      update: { tokenHash: 'reset-token-hash', expiresAt, usedAt: null },
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

  test('deleteByIdAndTokenHashはidとtokenHashが一致する行を削除する', async () => {
    prtDeleteMany.mockResolvedValue({ count: 1 })

    await expect(passwordResetTokenRepository.deleteByIdAndTokenHash(20, 'reset-token-hash')).resolves.toBe(1)
    expect(prtDeleteMany).toHaveBeenCalledWith({ where: { id: 20, tokenHash: 'reset-token-hash' } })
  })

  test('deleteByIdAndTokenHashはtokenHash不一致（別requestが更新済み）なら削除しない（count0）', async () => {
    // 並行requestで同じ行が新しいtokenHashへ更新済みの場合、後発トークンを保護する
    prtDeleteMany.mockResolvedValue({ count: 0 })

    await expect(passwordResetTokenRepository.deleteByIdAndTokenHash(20, 'old-token-hash')).resolves.toBe(0)
    expect(prtDeleteMany).toHaveBeenCalledWith({ where: { id: 20, tokenHash: 'old-token-hash' } })
  })

  test('confirmで未使用トークンを消費し、パスワード更新・全refresh失効を原子的に行う', async () => {
    prtTransactionUpdateMany.mockResolvedValue({ count: 1 })
    userTransactionUpdate.mockResolvedValue({})
    transactionUpdateMany.mockResolvedValue({ count: 2 })

    const result = await passwordResetTokenRepository.confirm(20, 1, 'new-hashed-password')

    expect(result).toBe(true)
    expect(transaction).toHaveBeenCalledTimes(1)
    // 未使用かつ有効期限内のみ消費する条件になっている
    expect(prtTransactionUpdateMany).toHaveBeenCalledWith({
      where: { id: 20, usedAt: null, expiresAt: { gt: expect.any(Date) } },
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

  test('confirmで期限切れ・使用済み・並行競合（条件不一致でcount0）はfalseを返し副作用なし', async () => {
    prtTransactionUpdateMany.mockResolvedValue({ count: 0 })

    const result = await passwordResetTokenRepository.confirm(20, 1, 'new-hashed-password')

    expect(result).toBe(false)
    // パスワード更新・refresh失効は実行しない
    expect(userTransactionUpdate).not.toHaveBeenCalled()
    expect(transactionUpdateMany).not.toHaveBeenCalled()
  })
})
