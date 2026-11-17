import { describe, expect, test } from 'bun:test'

import { confirmBodySchema } from '../emailVerification'

describe('confirmBodySchema', () => {
  test('正しいtokenを受け付ける', () => {
    expect(confirmBodySchema.safeParse({ token: 'valid-token' }).success).toBe(true)
  })

  test('tokenが空文字または欠如なら拒否する', () => {
    expect(confirmBodySchema.safeParse({ token: '' }).success).toBe(false)
    expect(confirmBodySchema.safeParse({}).success).toBe(false)
  })
})
