import { describe, expect, test } from 'bun:test'

import { bodySchema } from './signup'

describe('bodySchema', () => {
  test('正しいトークン・名前・パスワードを受け付ける', () => {
    const result = bodySchema.safeParse({
      token: 'some-token',
      name: 'Invitee',
      password: 'password123',
    })

    expect(result.success).toBe(true)
  })

  test('emailフィールドを持たなくても受け付ける', () => {
    const result = bodySchema.safeParse({
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
    const result = bodySchema.safeParse({
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
    const result = bodySchema.safeParse({
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
    const result = bodySchema.safeParse({
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
    expect(bodySchema.safeParse({ token: 'some-token', password: 'password123' }).success).toBe(false)
    expect(bodySchema.safeParse({ name: 'Invitee', password: 'password123' }).success).toBe(false)
    expect(bodySchema.safeParse({ token: 'some-token', name: 'Invitee' }).success).toBe(false)
  })
})
