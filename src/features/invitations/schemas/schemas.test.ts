import { describe, expect, test } from 'bun:test'

import { acceptInvitationBodySchema } from '.'

describe('acceptInvitationBodySchema', () => {
  test('正しいトークンを受け付ける', () => {
    expect(acceptInvitationBodySchema.safeParse({ token: 'some-token' }).success).toBe(true)
  })

  test('UUIDトークンを受け付ける', () => {
    expect(acceptInvitationBodySchema.safeParse({ token: '550e8400-e29b-41d4-a716-446655440000' }).success).toBe(true)
  })

  test('空のトークンを拒否する', () => {
    const result = acceptInvitationBodySchema.safeParse({ token: '' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('招待トークンは必須です')
    }
  })

  test('tokenフィールドが欠けている場合を拒否する', () => {
    expect(acceptInvitationBodySchema.safeParse({}).success).toBe(false)
  })

  test('tokenがnullの場合を拒否する', () => {
    expect(acceptInvitationBodySchema.safeParse({ token: null }).success).toBe(false)
  })
})
