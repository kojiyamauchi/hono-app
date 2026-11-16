import { describe, expect, test } from 'bun:test'

import { idParamSchema } from './common'

describe('idParamSchema', () => {
  test('数値文字列のIDをnumberへ変換する', () => {
    const result = idParamSchema.safeParse({ id: '1' })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.id).toBe(1)
    }
  })

  test('1未満のIDを拒否する', () => {
    expect(idParamSchema.safeParse({ id: '0' }).success).toBe(false)
  })

  test('数値ではないIDを拒否する', () => {
    expect(idParamSchema.safeParse({ id: 'abc' }).success).toBe(false)
  })
})
