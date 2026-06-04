import { describe, expect, test } from 'bun:test'

import { loginSchema, signupSchema } from '.'

describe('signupSchema', () => {
  test('正しい入力を受け付ける', () => {
    const result = signupSchema.safeParse({ email: 'taro@example.com', password: 'password123' })
    expect(result.success).toBe(true)
  })

  test('不正なメール形式を拒否する', () => {
    const result = signupSchema.safeParse({ email: 'invalid-email', password: 'password123' })
    expect(result.success).toBe(false)
  })

  test('8文字未満のパスワードを拒否する', () => {
    const result = signupSchema.safeParse({ email: 'taro@example.com', password: 'short' })
    expect(result.success).toBe(false)
  })
})

describe('loginSchema', () => {
  test('正しい入力を受け付ける', () => {
    const result = loginSchema.safeParse({ email: 'taro@example.com', password: 'anything' })
    expect(result.success).toBe(true)
  })

  test('不正なメール形式を拒否する', () => {
    const result = loginSchema.safeParse({ email: 'invalid-email', password: 'anything' })
    expect(result.success).toBe(false)
  })
})
