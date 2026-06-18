import { describe, expect, test } from 'bun:test'

import { acceptInvitationBodySchema, declineInvitationBodySchema, invitationTokenParamSchema, signupInvitationBodySchema } from '.'

describe('invitationTokenParamSchema', () => {
  test('正しいトークンを受け付ける', () => {
    expect(invitationTokenParamSchema.safeParse({ token: 'some-token' }).success).toBe(true)
  })

  test('UUIDトークンを受け付ける', () => {
    expect(invitationTokenParamSchema.safeParse({ token: '550e8400-e29b-41d4-a716-446655440000' }).success).toBe(true)
  })

  test('空のトークンを拒否する', () => {
    const result = invitationTokenParamSchema.safeParse({ token: '' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('招待トークンは必須です')
    }
  })

  test('tokenフィールドが欠けている場合を拒否する', () => {
    expect(invitationTokenParamSchema.safeParse({}).success).toBe(false)
  })

  test('tokenがnullの場合を拒否する', () => {
    expect(invitationTokenParamSchema.safeParse({ token: null }).success).toBe(false)
  })
})

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

describe('declineInvitationBodySchema', () => {
  test('正しいトークンを受け付ける', () => {
    expect(declineInvitationBodySchema.safeParse({ token: 'some-token' }).success).toBe(true)
  })

  test('UUIDトークンを受け付ける', () => {
    expect(declineInvitationBodySchema.safeParse({ token: '550e8400-e29b-41d4-a716-446655440000' }).success).toBe(true)
  })

  test('空のトークンを拒否する', () => {
    const result = declineInvitationBodySchema.safeParse({ token: '' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('招待トークンは必須です')
    }
  })

  test('tokenフィールドが欠けている場合を拒否する', () => {
    expect(declineInvitationBodySchema.safeParse({}).success).toBe(false)
  })

  test('tokenがnullの場合を拒否する', () => {
    expect(declineInvitationBodySchema.safeParse({ token: null }).success).toBe(false)
  })
})

describe('signupInvitationBodySchema', () => {
  test('正しいトークン・名前・パスワードを受け付ける', () => {
    const result = signupInvitationBodySchema.safeParse({
      token: 'some-token',
      name: 'Invitee',
      password: 'password123',
    })

    expect(result.success).toBe(true)
  })

  test('emailフィールドを持たなくても受け付ける', () => {
    const result = signupInvitationBodySchema.safeParse({
      token: 'some-token',
      name: 'Invitee',
      password: 'password123',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).not.toHaveProperty('email')
    }
  })

  test('空のトークンを拒否する', () => {
    const result = signupInvitationBodySchema.safeParse({
      token: '',
      name: 'Invitee',
      password: 'password123',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('招待トークンは必須です')
    }
  })

  test('空の名前を拒否する', () => {
    const result = signupInvitationBodySchema.safeParse({
      token: 'some-token',
      name: '',
      password: 'password123',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('名前は必須です')
    }
  })

  test('8文字未満のパスワードを拒否する', () => {
    const result = signupInvitationBodySchema.safeParse({
      token: 'some-token',
      name: 'Invitee',
      password: 'short',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('パスワードは8文字以上で入力してください')
    }
  })

  test('必須フィールドが欠けている場合を拒否する', () => {
    expect(signupInvitationBodySchema.safeParse({ token: 'some-token', password: 'password123' }).success).toBe(false)
    expect(signupInvitationBodySchema.safeParse({ name: 'Invitee', password: 'password123' }).success).toBe(false)
    expect(signupInvitationBodySchema.safeParse({ token: 'some-token', name: 'Invitee' }).success).toBe(false)
  })
})
