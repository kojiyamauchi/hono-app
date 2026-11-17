import { describe, expect, test } from 'bun:test'

import { bodySchema } from '../changePassword'

describe('bodySchema', () => {
  test('正しいcurrentPassword・newPasswordを受け付ける', () => {
    const result = bodySchema.safeParse({
      currentPassword: 'current-password-123',
      newPassword: 'new-password-123',
    })
    expect(result.success).toBe(true)
  })

  test('currentPasswordが空文字なら拒否する', () => {
    const result = bodySchema.safeParse({
      currentPassword: '',
      newPassword: 'new-password-123',
    })
    expect(result.success).toBe(false)
  })

  test('8文字未満のnewPasswordを拒否する', () => {
    const result = bodySchema.safeParse({
      currentPassword: 'current-password-123',
      newPassword: 'short',
    })
    expect(result.success).toBe(false)
  })

  test('currentPasswordとnewPasswordが同じなら拒否する', () => {
    const result = bodySchema.safeParse({
      currentPassword: 'same-password-123',
      newPassword: 'same-password-123',
    })
    expect(result.success).toBe(false)
  })
})
