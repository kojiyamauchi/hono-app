import { describe, expect, test } from 'bun:test'

import { itemParamSchema } from './sessions'

describe('itemParamSchema', () => {
  test('UUID形式のidを受け付ける', () => {
    const result = itemParamSchema.safeParse({ id: '550e8400-e29b-41d4-a716-446655440000' })

    expect(result.success).toBe(true)
  })

  test('UUIDではないidを拒否する', () => {
    const result = itemParamSchema.safeParse({ id: 'not-a-uuid' })

    expect(result.success).toBe(false)
  })
})
