import { describe, expect, test } from 'bun:test'

import {
  addMemberBodySchema,
  createInvitationBodySchema,
  createOrganizationSchema,
  invitationRouteParamSchema,
  listMembersQuerySchema,
  listMineQuerySchema,
  memberRouteParamSchema,
  organizationIdParamSchema,
  transferOwnershipBodySchema,
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

describe('transferOwnershipBodySchema', () => {
  test('正の整数のmembershipIdを受け付ける', () => {
    expect(transferOwnershipBodySchema.safeParse({ membershipId: 2 }).success).toBe(true)
  })

  test('membershipIdがなければ拒否する', () => {
    expect(transferOwnershipBodySchema.safeParse({}).success).toBe(false)
  })

  test('整数ではないmembershipIdを拒否する', () => {
    expect(transferOwnershipBodySchema.safeParse({ membershipId: 1.5 }).success).toBe(false)
  })

  test('1未満のmembershipIdを拒否する', () => {
    expect(transferOwnershipBodySchema.safeParse({ membershipId: 0 }).success).toBe(false)
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

describe('createInvitationBodySchema', () => {
  test('MEMBERロールを受け付ける', () => {
    expect(createInvitationBodySchema.safeParse({ email: 'user@example.com', role: 'MEMBER' }).success).toBe(true)
  })

  test('ADMINロールを受け付ける', () => {
    expect(createInvitationBodySchema.safeParse({ email: 'user@example.com', role: 'ADMIN' }).success).toBe(true)
  })

  test('OWNERロールを形式上は受け付ける（意味的バリデーションはservice層）', () => {
    expect(createInvitationBodySchema.safeParse({ email: 'user@example.com', role: 'OWNER' }).success).toBe(true)
  })

  test('不正なメールアドレスを拒否する', () => {
    expect(createInvitationBodySchema.safeParse({ email: 'not-an-email', role: 'MEMBER' }).success).toBe(false)
  })

  test('emailがなければ拒否する', () => {
    expect(createInvitationBodySchema.safeParse({ role: 'MEMBER' }).success).toBe(false)
  })

  test('roleがなければ拒否する', () => {
    expect(createInvitationBodySchema.safeParse({ email: 'user@example.com' }).success).toBe(false)
  })
})

describe('invitationRouteParamSchema', () => {
  test('数値文字列のidとinvitationIdをnumberへ変換する', () => {
    const result = invitationRouteParamSchema.safeParse({ id: '1', invitationId: '2' })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.id).toBe(1)
      expect(result.data.invitationId).toBe(2)
    }
  })

  test('1未満のinvitationIdを拒否する', () => {
    expect(invitationRouteParamSchema.safeParse({ id: '1', invitationId: '0' }).success).toBe(false)
  })

  test('数値ではないinvitationIdを拒否する', () => {
    expect(invitationRouteParamSchema.safeParse({ id: '1', invitationId: 'abc' }).success).toBe(false)
  })
})

describe('listMembersQuerySchema', () => {
  test('query未指定ならlimitは20になり、cursorは未指定のままになる', () => {
    const result = listMembersQuerySchema.safeParse({})

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.limit).toBe(20)
      expect(result.data.cursor).toBeUndefined()
    }
  })

  test('limitとcursorを受け付け、limitを数値へ変換する', () => {
    const result = listMembersQuerySchema.safeParse({ limit: '50', cursor: 'abc' })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.limit).toBe(50)
      expect(result.data.cursor).toBe('abc')
    }
  })

  test.each(['1', '100'])('limitの境界値%sを受け付ける', (limit) => {
    expect(listMembersQuerySchema.safeParse({ limit }).success).toBe(true)
  })

  test.each(['0', '101', 'abc', '', '1.5', '-1'])('不正なlimit(%p)を拒否する', (limit) => {
    expect(listMembersQuerySchema.safeParse({ limit }).success).toBe(false)
  })

  test('空文字のcursorを拒否する', () => {
    expect(listMembersQuerySchema.safeParse({ cursor: '' }).success).toBe(false)
  })

  test('未対応のoffset指定を拒否する', () => {
    expect(listMembersQuerySchema.safeParse({ offset: '0' }).success).toBe(false)
  })
})

describe('listMineQuerySchema', () => {
  test('query未指定ならlimitは20、offsetは0になる', () => {
    const result = listMineQuerySchema.safeParse({})

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.limit).toBe(20)
      expect(result.data.offset).toBe(0)
    }
  })

  test('limitとoffsetを数値へ変換する', () => {
    const result = listMineQuerySchema.safeParse({ limit: '5', offset: '10' })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.limit).toBe(5)
      expect(result.data.offset).toBe(10)
    }
  })

  test.each(['0', '10000'])('offsetの境界値%sを受け付ける', (offset) => {
    expect(listMineQuerySchema.safeParse({ offset }).success).toBe(true)
  })

  test.each(['10001', '-1', 'abc', '1.5'])('不正なoffset(%p)を拒否する', (offset) => {
    expect(listMineQuerySchema.safeParse({ offset }).success).toBe(false)
  })

  test.each(['0', '101', 'abc', ''])('不正なlimit(%p)を拒否する', (limit) => {
    expect(listMineQuerySchema.safeParse({ limit }).success).toBe(false)
  })

  test('未対応のcursor指定を拒否する', () => {
    expect(listMineQuerySchema.safeParse({ cursor: 'abc' }).success).toBe(false)
  })
})
