import { beforeEach, describe, expect, mock, test } from 'bun:test'

const queryRaw = mock()
const updateManyInvitations = mock()
const deleteUser = mock()
const transaction = mock(async (callback: (tx: unknown) => Promise<unknown>) =>
  callback({
    $queryRaw: queryRaw,
    invitation: { updateMany: updateManyInvitations },
    user: { delete: deleteUser },
  }),
)

await mock.module('@/libs/prisma', () => ({
  prisma: { $transaction: transaction },
}))

const { accountDeletionRepository, accountDeletionResults } = await import('.')

describe('accountDeletionRepository.deleteAccount', () => {
  beforeEach(() => {
    queryRaw.mockReset()
    updateManyInvitations.mockReset()
    deleteUser.mockReset()
    transaction.mockClear()
  })

  test('パスワード検証後にPENDING招待を失効し、ユーザーを削除する', async () => {
    queryRaw.mockResolvedValueOnce([{ id: 1, email: 'taro@example.com', password: 'hashed-password' }]).mockResolvedValueOnce([])
    updateManyInvitations.mockResolvedValue({ count: 2 })
    deleteUser.mockResolvedValue({ id: 1 })
    const verifyPassword = mock(async (passwordHash: string) => passwordHash === 'hashed-password')

    const result = await accountDeletionRepository.deleteAccount(1, verifyPassword)

    expect(result).toBe(accountDeletionResults.deleted)
    expect(verifyPassword).toHaveBeenCalledWith('hashed-password')
    expect(updateManyInvitations).toHaveBeenCalledWith({
      where: { email: 'taro@example.com', status: 'PENDING' },
      data: { status: 'CANCELED' },
    })
    expect(deleteUser).toHaveBeenCalledWith({ where: { id: 1 } })
  })

  test('User行が存在しない場合は何も変更せずNOT_FOUNDを返す', async () => {
    queryRaw.mockResolvedValueOnce([])
    const verifyPassword = mock(async () => true)

    const result = await accountDeletionRepository.deleteAccount(999, verifyPassword)

    expect(result).toBe(accountDeletionResults.notFound)
    expect(verifyPassword).not.toHaveBeenCalled()
    expect(updateManyInvitations).not.toHaveBeenCalled()
    expect(deleteUser).not.toHaveBeenCalled()
  })

  test('パスワード不一致の場合は何も変更せずINVALID_PASSWORDを返す', async () => {
    queryRaw.mockResolvedValueOnce([{ id: 1, email: 'taro@example.com', password: 'hashed-password' }])
    const verifyPassword = mock(async () => false)

    const result = await accountDeletionRepository.deleteAccount(1, verifyPassword)

    expect(result).toBe(accountDeletionResults.invalidPassword)
    expect(updateManyInvitations).not.toHaveBeenCalled()
    expect(deleteUser).not.toHaveBeenCalled()
  })

  test('唯一のOWNERである組織が存在する場合は何も変更せずSOLE_OWNERを返す', async () => {
    queryRaw.mockResolvedValueOnce([{ id: 1, email: 'taro@example.com', password: 'hashed-password' }]).mockResolvedValueOnce([{ id: 10 }])
    const verifyPassword = mock(async () => true)

    const result = await accountDeletionRepository.deleteAccount(1, verifyPassword)

    expect(result).toBe(accountDeletionResults.soleOwner)
    expect(updateManyInvitations).not.toHaveBeenCalled()
    expect(deleteUser).not.toHaveBeenCalled()
  })

  test('transaction内の削除エラーはそのままthrowする', async () => {
    queryRaw.mockResolvedValueOnce([{ id: 1, email: 'taro@example.com', password: 'hashed-password' }]).mockResolvedValueOnce([])
    updateManyInvitations.mockResolvedValue({ count: 1 })
    deleteUser.mockRejectedValue(new Error('削除エラー'))

    await expect(accountDeletionRepository.deleteAccount(1, async () => true)).rejects.toThrow('削除エラー')
  })
})
