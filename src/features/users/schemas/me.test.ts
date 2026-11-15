import { describe, expect, test } from 'bun:test'

import { removeBodySchema, updateBodySchema } from './me'

describe('updateBodySchema', () => {
  test('正しい入力を受け付ける', () => {
    const result = updateBodySchema.safeParse({ name: 'Taro' })

    expect(result.success).toBe(true)
  })

  test('名前が空文字なら拒否する', () => {
    const result = updateBodySchema.safeParse({ name: '' })

    expect(result.success).toBe(false)
  })
})

describe('removeBodySchema', () => {
  test('現在のパスワードがあれば受け付ける', () => {
    expect(removeBodySchema.safeParse({ currentPassword: 'password123' }).success).toBe(true)
  })

  test('現在のパスワードが空文字なら拒否する', () => {
    expect(removeBodySchema.safeParse({ currentPassword: '' }).success).toBe(false)
  })

  test('bodyが空なら拒否する', () => {
    expect(removeBodySchema.safeParse({}).success).toBe(false)
  })
})
