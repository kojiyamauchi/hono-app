import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { Prisma } from '@/generated/prisma/client'
import type { User } from '@/shared/user/entities'

const create = mock()
const findUnique = mock()
const update = mock()

await mock.module('@/libs/prisma', () => ({
  prisma: {
    user: { create, findUnique, update },
  },
}))

const { userRepository } = await import('.')

const createdAt = new Date('2026-06-18T00:00:00.000Z')
const input = {
  name: 'Taro',
  email: 'taro@example.com',
  password: 'hashed-password',
}
const user: User = {
  id: 1,
  ...input,
  createdAt,
  updatedAt: createdAt,
}

/** テスト用のP2002（一意制約違反）エラーを生成する。 */
const uniqueConstraintError = (): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  })

describe('userRepository.create', () => {
  beforeEach(() => {
    create.mockReset()
  })

  test('作成に成功した場合はUserを返す', async () => {
    create.mockResolvedValue(user)

    const result = await userRepository.create(input)

    expect(result).toEqual(user)
    expect(create).toHaveBeenCalledWith({ data: input })
  })

  test('一意制約違反（P2002）の場合はnullを返す', async () => {
    create.mockRejectedValue(uniqueConstraintError())

    const result = await userRepository.create(input)

    expect(result).toBeNull()
  })

  test('P2002以外のエラーはそのままthrowする', async () => {
    const error = new Error('接続エラー')
    create.mockRejectedValue(error)

    await expect(userRepository.create(input)).rejects.toThrow('接続エラー')
  })
})
