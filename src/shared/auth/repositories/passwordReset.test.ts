import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { PasswordResetToken } from '@/shared/auth/entities/passwordReset'

const transactionUpdateMany = mock()
const prtTransactionCreate = mock()
const prtTransactionFindUnique = mock()
const prtTransactionUpdateMany = mock()
const prtTransactionDeleteMany = mock()
const userTransactionUpdate = mock()
const prtCreate = mock()
const prtFindUnique = mock()
const prtUpdateMany = mock()
const prtDelete = mock()
const prtDeleteMany = mock()
const prtUpsert = mock()
const transaction = mock(async (callback: (tx: unknown) => Promise<unknown>) =>
  callback({
    refreshToken: { updateMany: transactionUpdateMany },
    passwordResetToken: {
      create: prtTransactionCreate,
      findUnique: prtTransactionFindUnique,
      updateMany: prtTransactionUpdateMany,
      deleteMany: prtTransactionDeleteMany,
    },
    user: { update: userTransactionUpdate },
  }),
)

await mock.module('@/libs/prisma', () => ({
  prisma: {
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

const { passwordResetTokenRepository } = await import('./passwordReset')

const expiresAt = new Date('2026-07-01T00:00:00.000Z')
const createdAt = new Date('2026-06-18T00:00:00.000Z')
const passwordResetToken: PasswordResetToken = {
  id: 20,
  userId: 1,
  tokenHash: 'reset-token-hash',
  expiresAt,
  usedAt: null,
  createdAt,
}

beforeEach(() => {
  transaction.mockClear()
  transactionUpdateMany.mockReset()
  prtTransactionCreate.mockReset()
  prtTransactionFindUnique.mockReset()
  prtTransactionUpdateMany.mockReset()
  prtTransactionDeleteMany.mockReset()
  userTransactionUpdate.mockReset()
  prtCreate.mockReset()
  prtFindUnique.mockReset()
  prtUpdateMany.mockReset()
  prtDelete.mockReset()
  prtDeleteMany.mockReset()
  prtUpsert.mockReset()
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
