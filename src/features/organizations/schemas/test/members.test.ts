import { describe, expect, test } from 'bun:test'

import { addBodySchema, itemParamSchema, listQuerySchema, updateRoleBodySchema } from '../members'

describe('addBodySchema', () => {
  test('正しい入力を受け付ける', () => {
    expect(addBodySchema.safeParse({ email: 'user@example.com', role: 'MEMBER' }).success).toBe(true)
  })

  test('ADMINロールを受け付ける', () => {
    expect(addBodySchema.safeParse({ email: 'user@example.com', role: 'ADMIN' }).success).toBe(true)
  })

  test('OWNERロールを受け付ける（意味的バリデーションはservice層で行う）', () => {
    expect(addBodySchema.safeParse({ email: 'user@example.com', role: 'OWNER' }).success).toBe(true)
  })

  test('不正なメールアドレスを拒否する', () => {
    expect(addBodySchema.safeParse({ email: 'not-an-email', role: 'MEMBER' }).success).toBe(false)
  })

  test('emailがなければ拒否する', () => {
    expect(addBodySchema.safeParse({ role: 'MEMBER' }).success).toBe(false)
  })

  test('roleがなければ拒否する', () => {
    expect(addBodySchema.safeParse({ email: 'user@example.com' }).success).toBe(false)
  })
})

describe('updateRoleBodySchema', () => {
  test('MEMBERロールを受け付ける', () => {
    expect(updateRoleBodySchema.safeParse({ role: 'MEMBER' }).success).toBe(true)
  })

  test('ADMINロールを受け付ける', () => {
    expect(updateRoleBodySchema.safeParse({ role: 'ADMIN' }).success).toBe(true)
  })

  test('OWNERロールを受け付ける（意味的バリデーションはservice層で行う）', () => {
    expect(updateRoleBodySchema.safeParse({ role: 'OWNER' }).success).toBe(true)
  })

  test('roleがなければ拒否する', () => {
    expect(updateRoleBodySchema.safeParse({}).success).toBe(false)
  })
})

describe('itemParamSchema', () => {
  test('数値文字列のidとmembershipIdをnumberへ変換する', () => {
    const result = itemParamSchema.safeParse({ id: '1', membershipId: '2' })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.id).toBe(1)
      expect(result.data.membershipId).toBe(2)
    }
  })

  test('1未満のmembershipIdを拒否する', () => {
    expect(itemParamSchema.safeParse({ id: '1', membershipId: '0' }).success).toBe(false)
  })

  test('数値ではないmembershipIdを拒否する', () => {
    expect(itemParamSchema.safeParse({ id: '1', membershipId: 'abc' }).success).toBe(false)
  })
})

describe('listQuerySchema', () => {
  test('query未指定ならlimitは20になり、cursorは未指定のままになる', () => {
    const result = listQuerySchema.safeParse({})

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.limit).toBe(20)
      expect(result.data.cursor).toBeUndefined()
    }
  })

  test('limitとcursorを受け付け、limitを数値へ変換する', () => {
    const result = listQuerySchema.safeParse({ limit: '50', cursor: 'abc' })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.limit).toBe(50)
      expect(result.data.cursor).toBe('abc')
    }
  })

  test.each(['1', '100'])('limitの境界値%sを受け付ける', (limit) => {
    expect(listQuerySchema.safeParse({ limit }).success).toBe(true)
  })

  test.each(['0', '101', 'abc', '', ' ', '1.5', '-1'])('不正なlimit(%p)を拒否する', (limit) => {
    expect(listQuerySchema.safeParse({ limit }).success).toBe(false)
  })

  test('空文字のcursorを拒否する', () => {
    expect(listQuerySchema.safeParse({ cursor: '' }).success).toBe(false)
  })

  test('未対応のoffset指定を拒否する', () => {
    expect(listQuerySchema.safeParse({ offset: '0' }).success).toBe(false)
  })
})
