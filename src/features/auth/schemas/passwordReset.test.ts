import { describe, expect, test } from 'bun:test'

import { confirmBodySchema, requestBodySchema } from './passwordReset'

describe('requestBodySchema', () => {
  test('正しいメールアドレスを受け付ける', () => {
    const result = requestBodySchema.safeParse({ email: 'taro@example.com' })
    expect(result.success).toBe(true)
  })

  test('不正なメール形式を拒否する', () => {
    const result = requestBodySchema.safeParse({ email: 'invalid-email' })
    expect(result.success).toBe(false)
  })

  test('emailが空の場合は拒否する', () => {
    const result = requestBodySchema.safeParse({ email: '' })
    expect(result.success).toBe(false)
  })
})

describe('confirmBodySchema', () => {
  test('正しいtoken・passwordを受け付ける', () => {
    const result = confirmBodySchema.safeParse({ token: 'valid-token', password: 'password123' })
    expect(result.success).toBe(true)
  })

  test('tokenが空文字なら拒否する', () => {
    const result = confirmBodySchema.safeParse({ token: '', password: 'password123' })
    expect(result.success).toBe(false)
  })

  test('8文字未満のパスワードを拒否する', () => {
    const result = confirmBodySchema.safeParse({ token: 'valid-token', password: 'short' })
    expect(result.success).toBe(false)
  })

  test('passwordが空文字なら拒否する', () => {
    const result = confirmBodySchema.safeParse({ token: 'valid-token', password: '' })
    expect(result.success).toBe(false)
  })
})
