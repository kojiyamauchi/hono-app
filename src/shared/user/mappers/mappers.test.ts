import { describe, expect, test } from 'bun:test'

import type { User } from '@/shared/user/entities'

import { toPublicUserResponse, toUserResponse } from '.'

const user: User = {
  id: 1,
  name: 'Taro',
  email: 'taro@example.com',
  password: 'hashed-password',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
}

describe('toUserResponse', () => {
  test('passwordを除外したユーザー情報を返す', () => {
    const result = toUserResponse(user)

    expect(result).toEqual({
      id: 1,
      name: 'Taro',
      email: 'taro@example.com',
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    })
    expect(result).not.toHaveProperty('password')
  })
})

describe('toPublicUserResponse', () => {
  test('公開可能なidとnameだけを返す', () => {
    const result = toPublicUserResponse(user)

    expect(result).toEqual({
      id: 1,
      name: 'Taro',
    })
    expect(result).not.toHaveProperty('email')
    expect(result).not.toHaveProperty('password')
  })
})
