import { describe, expect, test } from 'bun:test'

import { bodySchema } from '../signup'

describe('bodySchema', () => {
  test('正しい入力を受け付ける', () => {
    const result = bodySchema.safeParse({
      name: 'Taro',
      email: 'taro@example.com',
      password: 'password123',
    })
    expect(result.success).toBe(true)
  })

  test('不正なメール形式を拒否する', () => {
    const result = bodySchema.safeParse({
      name: 'Taro',
      email: 'invalid-email',
      password: 'password123',
    })
    expect(result.success).toBe(false)
  })

  test('8文字未満のパスワードを拒否する', () => {
    const result = bodySchema.safeParse({
      name: 'Taro',
      email: 'taro@example.com',
      password: 'short',
    })
    expect(result.success).toBe(false)
  })

  test('名前が空文字なら拒否する', () => {
    const result = bodySchema.safeParse({
      name: '',
      email: 'taro@example.com',
      password: 'password123',
    })
    expect(result.success).toBe(false)
  })
})
