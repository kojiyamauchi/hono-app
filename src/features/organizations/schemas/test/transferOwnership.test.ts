import { describe, expect, test } from 'bun:test'

import { bodySchema } from '../transferOwnership'

describe('bodySchema', () => {
  test('正の整数のmembershipIdを受け付ける', () => {
    expect(bodySchema.safeParse({ membershipId: 2 }).success).toBe(true)
  })

  test('membershipIdがなければ拒否する', () => {
    expect(bodySchema.safeParse({}).success).toBe(false)
  })

  test('整数ではないmembershipIdを拒否する', () => {
    expect(bodySchema.safeParse({ membershipId: 1.5 }).success).toBe(false)
  })

  test('1未満のmembershipIdを拒否する', () => {
    expect(bodySchema.safeParse({ membershipId: 0 }).success).toBe(false)
  })
})
