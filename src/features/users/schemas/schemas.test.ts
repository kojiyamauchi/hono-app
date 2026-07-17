import { describe, expect, test } from 'bun:test'

import { deleteMeSchema, updateMeSchema, userIdParamSchema } from '.'

describe('updateMeSchema', () => {
  test('正しい入力を受け付ける', () => {
    const result = updateMeSchema.safeParse({ name: 'Taro' })

    expect(result.success).toBe(true)
  })

  test('名前が空文字なら拒否する', () => {
    const result = updateMeSchema.safeParse({ name: '' })

    expect(result.success).toBe(false)
  })
})

describe('deleteMeSchema', () => {
  test('現在のパスワードがあれば受け付ける', () => {
    expect(deleteMeSchema.safeParse({ currentPassword: 'password123' }).success).toBe(true)
  })

  test('現在のパスワードが空文字なら拒否する', () => {
    expect(deleteMeSchema.safeParse({ currentPassword: '' }).success).toBe(false)
  })

  test('bodyが空なら拒否する', () => {
    expect(deleteMeSchema.safeParse({}).success).toBe(false)
  })
})

describe('userIdParamSchema', () => {
  test('数値文字列のIDをnumberへ変換する', () => {
    const result = userIdParamSchema.safeParse({ id: '1' })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.id).toBe(1)
    }
  })

  test('1未満のIDを拒否する', () => {
    const result = userIdParamSchema.safeParse({ id: '0' })

    expect(result.success).toBe(false)
  })

  test('数値ではないIDを拒否する', () => {
    const result = userIdParamSchema.safeParse({ id: 'me' })

    expect(result.success).toBe(false)
  })
})
