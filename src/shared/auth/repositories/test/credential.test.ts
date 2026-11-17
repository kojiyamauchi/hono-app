import { beforeEach, describe, expect, mock, test } from 'bun:test'

const transactionUpdateMany = mock()
const userTransactionUpdateMany = mock()
const transaction = mock(async (callback: (tx: unknown) => Promise<unknown>) =>
  callback({
    refreshToken: { updateMany: transactionUpdateMany },
    user: { updateMany: userTransactionUpdateMany },
  }),
)

await mock.module('@/libs/prisma', () => ({
  prisma: {
    $transaction: transaction,
  },
}))

const { authCredentialRepository } = await import('../credential')

beforeEach(() => {
  transaction.mockClear()
  transactionUpdateMany.mockReset()
  userTransactionUpdateMany.mockReset()
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
