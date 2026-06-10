import { describe, expect, test } from 'bun:test'

import { createOrganizationSchema, organizationIdParamSchema, updateOrganizationSchema } from '.'

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
