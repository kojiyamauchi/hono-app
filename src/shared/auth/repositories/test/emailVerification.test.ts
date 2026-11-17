import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { EmailVerificationToken } from '@/shared/auth/entities/emailVerification'

const evtTransactionUpdateMany = mock()
const userTransactionUpdate = mock()
const evtFindUnique = mock()
const evtDeleteMany = mock()
const evtUpsert = mock()
const transaction = mock(async (callback: (tx: unknown) => Promise<unknown>) =>
  callback({
    emailVerificationToken: { updateMany: evtTransactionUpdateMany },
    user: { update: userTransactionUpdate },
  }),
)

await mock.module('@/libs/prisma', () => ({
  prisma: {
    emailVerificationToken: {
      findUnique: evtFindUnique,
      deleteMany: evtDeleteMany,
      upsert: evtUpsert,
    },
    $transaction: transaction,
  },
}))

const { emailVerificationTokenRepository } = await import('../emailVerification')

const expiresAt = new Date('2026-07-01T00:00:00.000Z')
const createdAt = new Date('2026-06-18T00:00:00.000Z')
const emailVerificationToken: EmailVerificationToken = {
  id: 30,
  userId: 1,
  tokenHash: 'email-verification-token-hash',
  expiresAt,
  usedAt: null,
  createdAt,
}

beforeEach(() => {
  transaction.mockClear()
  evtTransactionUpdateMany.mockReset()
  userTransactionUpdate.mockReset()
  evtFindUnique.mockReset()
  evtDeleteMany.mockReset()
  evtUpsert.mockReset()
})

describe('emailVerificationTokenRepository', () => {
  test('createはuserId一意のupsertで再送時に旧トークンを置き換える', async () => {
    evtUpsert.mockResolvedValue(emailVerificationToken)

    const result = await emailVerificationTokenRepository.create(1, 'email-verification-token-hash', expiresAt)

    expect(result).toEqual(emailVerificationToken)
    expect(evtUpsert).toHaveBeenCalledWith({
      where: { userId: 1 },
      create: { userId: 1, tokenHash: 'email-verification-token-hash', expiresAt },
      update: { tokenHash: 'email-verification-token-hash', expiresAt, usedAt: null },
    })
  })

  test('findByTokenHashでトークンを取得する', async () => {
    evtFindUnique.mockResolvedValue(emailVerificationToken)

    await expect(emailVerificationTokenRepository.findByTokenHash('email-verification-token-hash')).resolves.toEqual(emailVerificationToken)
    expect(evtFindUnique).toHaveBeenCalledWith({ where: { tokenHash: 'email-verification-token-hash' } })
  })

  test('deleteByIdAndTokenHashは自分が発行したトークンだけを削除する', async () => {
    evtDeleteMany.mockResolvedValue({ count: 1 })

    await expect(emailVerificationTokenRepository.deleteByIdAndTokenHash(30, 'email-verification-token-hash')).resolves.toBe(1)
    expect(evtDeleteMany).toHaveBeenCalledWith({ where: { id: 30, tokenHash: 'email-verification-token-hash' } })
  })

  test('confirmで未使用トークンを消費し、メール検証日時を同一transactionで更新する', async () => {
    evtTransactionUpdateMany.mockResolvedValue({ count: 1 })
    userTransactionUpdate.mockResolvedValue({})

    const result = await emailVerificationTokenRepository.confirm(30, 1)

    expect(result).toBe(true)
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(evtTransactionUpdateMany).toHaveBeenCalledWith({
      where: { id: 30, usedAt: null, expiresAt: { gt: expect.any(Date) } },
      data: { usedAt: expect.any(Date) },
    })
    expect(userTransactionUpdate).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { emailVerifiedAt: expect.any(Date) },
    })
  })

  test('confirmで期限切れ・使用済み・並行競合の場合はfalseを返しユーザーを更新しない', async () => {
    evtTransactionUpdateMany.mockResolvedValue({ count: 0 })

    const result = await emailVerificationTokenRepository.confirm(30, 1)

    expect(result).toBe(false)
    expect(userTransactionUpdate).not.toHaveBeenCalled()
  })
})
