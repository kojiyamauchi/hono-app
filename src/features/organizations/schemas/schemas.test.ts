import { describe, expect, test } from 'bun:test'

import {
  addMemberBodySchema,
  createOrganizationSchema,
  memberRouteParamSchema,
  organizationIdParamSchema,
  updateMemberRoleBodySchema,
  updateOrganizationSchema,
} from '.'

describe('createOrganizationSchema', () => {
  test('正しい入力を受け付ける', () => {
    expect(createOrganizationSchema.safeParse({ name: 'Acme' }).success).toBe(true)
  })

  test('空の組織名を拒否する', () => {
    expect(createOrganizationSchema.safeParse({ name: '' }).success).toBe(false)
  })
})

describe('updateOrganizationSchema', () => {
  test('正しい入力を受け付ける', () => {
    expect(updateOrganizationSchema.safeParse({ name: 'Acme' }).success).toBe(true)
  })

  test('空の組織名を拒否する', () => {
    expect(updateOrganizationSchema.safeParse({ name: '' }).success).toBe(false)
  })
})

describe('organizationIdParamSchema', () => {
  test('数値文字列のIDをnumberへ変換する', () => {
    const result = organizationIdParamSchema.safeParse({ id: '1' })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.id).toBe(1)
    }
  })

  test('1未満のIDを拒否する', () => {
    expect(organizationIdParamSchema.safeParse({ id: '0' }).success).toBe(false)
  })

  test('数値ではないIDを拒否する', () => {
    expect(organizationIdParamSchema.safeParse({ id: 'abc' }).success).toBe(false)
  })
})

describe('addMemberBodySchema', () => {
  test('正しい入力を受け付ける', () => {
    expect(addMemberBodySchema.safeParse({ email: 'user@example.com', role: 'MEMBER' }).success).toBe(true)
  })

  test('ADMINロールを受け付ける', () => {
    expect(addMemberBodySchema.safeParse({ email: 'user@example.com', role: 'ADMIN' }).success).toBe(true)
  })

  test('OWNERロールを受け付ける（意味的バリデーションはservice層で行う）', () => {
    expect(addMemberBodySchema.safeParse({ email: 'user@example.com', role: 'OWNER' }).success).toBe(true)
  })

  test('不正なメールアドレスを拒否する', () => {
    expect(addMemberBodySchema.safeParse({ email: 'not-an-email', role: 'MEMBER' }).success).toBe(false)
  })

  test('emailがなければ拒否する', () => {
    expect(addMemberBodySchema.safeParse({ role: 'MEMBER' }).success).toBe(false)
  })

  test('roleがなければ拒否する', () => {
    expect(addMemberBodySchema.safeParse({ email: 'user@example.com' }).success).toBe(false)
  })
})

describe('updateMemberRoleBodySchema', () => {
  test('MEMBERロールを受け付ける', () => {
    expect(updateMemberRoleBodySchema.safeParse({ role: 'MEMBER' }).success).toBe(true)
  })

  test('ADMINロールを受け付ける', () => {
    expect(updateMemberRoleBodySchema.safeParse({ role: 'ADMIN' }).success).toBe(true)
  })

  test('OWNERロールを受け付ける（意味的バリデーションはservice層で行う）', () => {
    expect(updateMemberRoleBodySchema.safeParse({ role: 'OWNER' }).success).toBe(true)
  })

  test('roleがなければ拒否する', () => {
    expect(updateMemberRoleBodySchema.safeParse({}).success).toBe(false)
  })
})

describe('memberRouteParamSchema', () => {
  test('数値文字列のidとmembershipIdをnumberへ変換する', () => {
    const result = memberRouteParamSchema.safeParse({ id: '1', membershipId: '2' })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.id).toBe(1)
      expect(result.data.membershipId).toBe(2)
    }
  })

  test('1未満のmembershipIdを拒否する', () => {
    expect(memberRouteParamSchema.safeParse({ id: '1', membershipId: '0' }).success).toBe(false)
  })

  test('数値ではないmembershipIdを拒否する', () => {
    expect(memberRouteParamSchema.safeParse({ id: '1', membershipId: 'abc' }).success).toBe(false)
  })
})
