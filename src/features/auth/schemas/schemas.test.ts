import { describe, expect, test } from 'bun:test'

import {
  changePasswordSchema,
  confirmEmailVerificationSchema,
  confirmPasswordResetSchema,
  deleteSessionParamSchema,
  loginSchema,
  requestPasswordResetSchema,
  signupSchema,
} from '.'

describe('signupSchema', () => {
  test('正しい入力を受け付ける', () => {
    const result = signupSchema.safeParse({
      name: 'Taro',
      email: 'taro@example.com',
      password: 'password123',
    })
    expect(result.success).toBe(true)
  })

  test('不正なメール形式を拒否する', () => {
    const result = signupSchema.safeParse({
      name: 'Taro',
      email: 'invalid-email',
      password: 'password123',
    })
    expect(result.success).toBe(false)
  })

  test('8文字未満のパスワードを拒否する', () => {
    const result = signupSchema.safeParse({
      name: 'Taro',
      email: 'taro@example.com',
      password: 'short',
    })
    expect(result.success).toBe(false)
  })

  test('名前が空文字なら拒否する', () => {
    const result = signupSchema.safeParse({
      name: '',
      email: 'taro@example.com',
      password: 'password123',
    })
    expect(result.success).toBe(false)
  })
})

describe('loginSchema', () => {
  test('正しい入力を受け付ける', () => {
    const result = loginSchema.safeParse({
      email: 'taro@example.com',
      password: 'anything',
    })
    expect(result.success).toBe(true)
  })

  test('不正なメール形式を拒否する', () => {
    const result = loginSchema.safeParse({
      email: 'invalid-email',
      password: 'anything',
    })
    expect(result.success).toBe(false)
  })
})

describe('requestPasswordResetSchema', () => {
  test('正しいメールアドレスを受け付ける', () => {
    const result = requestPasswordResetSchema.safeParse({ email: 'taro@example.com' })
    expect(result.success).toBe(true)
  })

  test('不正なメール形式を拒否する', () => {
    const result = requestPasswordResetSchema.safeParse({ email: 'invalid-email' })
    expect(result.success).toBe(false)
  })

  test('emailが空の場合は拒否する', () => {
    const result = requestPasswordResetSchema.safeParse({ email: '' })
    expect(result.success).toBe(false)
  })
})

describe('confirmPasswordResetSchema', () => {
  test('正しいtoken・passwordを受け付ける', () => {
    const result = confirmPasswordResetSchema.safeParse({ token: 'valid-token', password: 'password123' })
    expect(result.success).toBe(true)
  })

  test('tokenが空文字なら拒否する', () => {
    const result = confirmPasswordResetSchema.safeParse({ token: '', password: 'password123' })
    expect(result.success).toBe(false)
  })

  test('8文字未満のパスワードを拒否する', () => {
    const result = confirmPasswordResetSchema.safeParse({ token: 'valid-token', password: 'short' })
    expect(result.success).toBe(false)
  })

  test('passwordが空文字なら拒否する', () => {
    const result = confirmPasswordResetSchema.safeParse({ token: 'valid-token', password: '' })
    expect(result.success).toBe(false)
  })
})

describe('confirmEmailVerificationSchema', () => {
  test('正しいtokenを受け付ける', () => {
    expect(confirmEmailVerificationSchema.safeParse({ token: 'valid-token' }).success).toBe(true)
  })

  test('tokenが空文字または欠如なら拒否する', () => {
    expect(confirmEmailVerificationSchema.safeParse({ token: '' }).success).toBe(false)
    expect(confirmEmailVerificationSchema.safeParse({}).success).toBe(false)
  })
})

describe('changePasswordSchema', () => {
  test('正しいcurrentPassword・newPasswordを受け付ける', () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: 'current-password-123',
      newPassword: 'new-password-123',
    })
    expect(result.success).toBe(true)
  })

  test('currentPasswordが空文字なら拒否する', () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: '',
      newPassword: 'new-password-123',
    })
    expect(result.success).toBe(false)
  })

  test('8文字未満のnewPasswordを拒否する', () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: 'current-password-123',
      newPassword: 'short',
    })
    expect(result.success).toBe(false)
  })

  test('currentPasswordとnewPasswordが同じなら拒否する', () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: 'same-password-123',
      newPassword: 'same-password-123',
    })
    expect(result.success).toBe(false)
  })
})

describe('deleteSessionParamSchema', () => {
  test('UUID形式のidを受け付ける', () => {
    const result = deleteSessionParamSchema.safeParse({ id: '550e8400-e29b-41d4-a716-446655440000' })

    expect(result.success).toBe(true)
  })

  test('UUIDではないidを拒否する', () => {
    const result = deleteSessionParamSchema.safeParse({ id: 'not-a-uuid' })

    expect(result.success).toBe(false)
  })
})
