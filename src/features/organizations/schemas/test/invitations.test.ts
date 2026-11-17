import { describe, expect, test } from 'bun:test'

import { createBodySchema, itemParamSchema } from '../invitations'

describe('createBodySchema', () => {
  test('MEMBERロールを受け付ける', () => {
    expect(createBodySchema.safeParse({ email: 'user@example.com', role: 'MEMBER' }).success).toBe(true)
  })

  test('ADMINロールを受け付ける', () => {
    expect(createBodySchema.safeParse({ email: 'user@example.com', role: 'ADMIN' }).success).toBe(true)
  })

  test('OWNERロールを形式上は受け付ける（意味的バリデーションはservice層）', () => {
    expect(createBodySchema.safeParse({ email: 'user@example.com', role: 'OWNER' }).success).toBe(true)
  })

  test('不正なメールアドレスを拒否する', () => {
    expect(createBodySchema.safeParse({ email: 'not-an-email', role: 'MEMBER' }).success).toBe(false)
  })

  test('emailがなければ拒否する', () => {
    expect(createBodySchema.safeParse({ role: 'MEMBER' }).success).toBe(false)
  })

  test('roleがなければ拒否する', () => {
    expect(createBodySchema.safeParse({ email: 'user@example.com' }).success).toBe(false)
  })
})

describe('itemParamSchema', () => {
  test('数値文字列のidとinvitationIdをnumberへ変換する', () => {
    const result = itemParamSchema.safeParse({ id: '1', invitationId: '2' })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.id).toBe(1)
      expect(result.data.invitationId).toBe(2)
    }
  })

  test('1未満のinvitationIdを拒否する', () => {
    expect(itemParamSchema.safeParse({ id: '1', invitationId: '0' }).success).toBe(false)
  })

  test('数値ではないinvitationIdを拒否する', () => {
    expect(itemParamSchema.safeParse({ id: '1', invitationId: 'abc' }).success).toBe(false)
  })
})
