import { describe, expect, test } from 'bun:test'

import { publicUserDto, userDto } from '@/shared/user/dtos'
import type { User } from '@/shared/user/entities'

import { toPublicUserResponse, toUserResponse } from '.'

const user: User = {
  id: 1,
  name: 'Taro',
  email: 'taro@example.com',
  password: 'hashed-password',
  emailVerifiedAt: null,
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
      emailVerified: false,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    })
    expect(result).not.toHaveProperty('password')
  })

  test('返却値がuserDto schemaに通る（DTO定義と実装の整合）', () => {
    const result = toUserResponse(user)

    expect(userDto.safeParse(result).success).toBe(true)
  })

  test('emailVerifiedAtが設定済みならemailVerifiedをtrueで返す', () => {
    const result = toUserResponse({ ...user, emailVerifiedAt: new Date('2026-01-03T00:00:00.000Z') })

    expect(result.emailVerified).toBe(true)
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

  test('返却値がpublicUserDto schemaに通る（DTO定義と実装の整合）', () => {
    const result = toPublicUserResponse(user)

    expect(publicUserDto.safeParse(result).success).toBe(true)
  })
})
