import { describe, expect, test } from 'bun:test'

import { bodySchema } from './login'

describe('bodySchema', () => {
  test('正しい入力を受け付ける', () => {
    const result = bodySchema.safeParse({
      email: 'taro@example.com',
      password: 'anything',
    })
    expect(result.success).toBe(true)
  })

  test('不正なメール形式を拒否する', () => {
    const result = bodySchema.safeParse({
      email: 'invalid-email',
      password: 'anything',
    })
    expect(result.success).toBe(false)
  })
})
