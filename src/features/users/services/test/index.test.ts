import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { User } from '@/shared/user/entities'

const findById = mock()

await mock.module('@/shared/user/repositories', () => ({
  userRepository: { findById },
}))

const { service } = await import('..')

const user: User = {
  id: 1,
  name: 'Taro',
  email: 'taro@example.com',
  password: 'hashed-password',
  emailVerifiedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
}

describe('service.getById', () => {
  beforeEach(() => {
    findById.mockReset()
  })

  test('指定IDのユーザー公開情報だけを返す', async () => {
    findById.mockResolvedValue(user)

    const result = await service.getById(1)

    expect(result).toEqual({
      id: 1,
      name: 'Taro',
    })
    expect(result).not.toHaveProperty('email')
    expect(result).not.toHaveProperty('password')
  })

  test('ユーザーが存在しないなら404エラーを投げる', async () => {
    findById.mockResolvedValue(null)

    await expect(service.getById(999)).rejects.toThrow('ユーザーが見つかりません')
  })
})
