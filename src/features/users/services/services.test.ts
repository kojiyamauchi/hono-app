import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { User } from '@/shared/user/entities'

const findById = mock()
const updateById = mock()

await mock.module('@/shared/user/repositories', () => ({
  userRepository: { findById, updateById },
}))

const { usersService } = await import('.')

const user: User = {
  id: 1,
  name: 'Taro',
  email: 'taro@example.com',
  password: 'hashed-password',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
}

describe('usersService.getMe', () => {
  beforeEach(() => {
    findById.mockReset()
    updateById.mockReset()
  })

  test('認証済みユーザー自身の詳細情報を返す', async () => {
    findById.mockResolvedValue(user)

    const result = await usersService.getMe(1)

    expect(result).toEqual({
      id: 1,
      name: 'Taro',
      email: 'taro@example.com',
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    })
    expect(result).not.toHaveProperty('password')
  })

  test('ユーザーが存在しないなら404エラーを投げる', async () => {
    findById.mockResolvedValue(null)

    await expect(usersService.getMe(999)).rejects.toThrow('ユーザーが見つかりません')
  })
})

describe('usersService.updateMe', () => {
  beforeEach(() => {
    findById.mockReset()
    updateById.mockReset()
  })

  test('認証済みユーザー自身の名前を更新して詳細情報を返す', async () => {
    const updatedUser = { ...user, name: 'Updated User' }
    findById.mockResolvedValue(user)
    updateById.mockResolvedValue(updatedUser)

    const result = await usersService.updateMe(1, { name: 'Updated User' })

    expect(updateById).toHaveBeenCalledWith(1, { name: 'Updated User' })
    expect(result.name).toBe('Updated User')
    expect(result.email).toBe('taro@example.com')
    expect(result).not.toHaveProperty('password')
  })

  test('ユーザーが存在しないなら更新せず404エラーを投げる', async () => {
    findById.mockResolvedValue(null)

    await expect(usersService.updateMe(999, { name: 'Updated User' })).rejects.toThrow('ユーザーが見つかりません')
    expect(updateById).not.toHaveBeenCalled()
  })

  test('更新時にユーザーが存在しなくなったら404エラーを投げる', async () => {
    findById.mockResolvedValue(user)
    updateById.mockResolvedValue(null)

    await expect(usersService.updateMe(1, { name: 'Updated User' })).rejects.toThrow('ユーザーが見つかりません')
  })
})

describe('usersService.getById', () => {
  beforeEach(() => {
    findById.mockReset()
    updateById.mockReset()
  })

  test('指定IDのユーザー公開情報だけを返す', async () => {
    findById.mockResolvedValue(user)

    const result = await usersService.getById(1)

    expect(result).toEqual({
      id: 1,
      name: 'Taro',
    })
    expect(result).not.toHaveProperty('email')
    expect(result).not.toHaveProperty('password')
  })

  test('ユーザーが存在しないなら404エラーを投げる', async () => {
    findById.mockResolvedValue(null)

    await expect(usersService.getById(999)).rejects.toThrow('ユーザーが見つかりません')
  })
})
