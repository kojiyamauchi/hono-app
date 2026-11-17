import { describe, expect, test } from 'bun:test'

import { createSchema, listMineQuerySchema, updateSchema } from '..'

describe('createSchema', () => {
  test('正しい入力を受け付ける', () => {
    expect(createSchema.safeParse({ name: 'Acme' }).success).toBe(true)
  })

  test('空の組織名を拒否する', () => {
    expect(createSchema.safeParse({ name: '' }).success).toBe(false)
  })
})

describe('updateSchema', () => {
  test('正しい入力を受け付ける', () => {
    expect(updateSchema.safeParse({ name: 'Acme' }).success).toBe(true)
  })

  test('空の組織名を拒否する', () => {
    expect(updateSchema.safeParse({ name: '' }).success).toBe(false)
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

  // 明示された空文字・空白は Number('') === 0 で既定値と同じ結果になってしまうため、
  // 未指定（既定値0）と区別して拒否されることを固定する。
  test.each(['10001', '-1', 'abc', '1.5', '', ' '])('不正なoffset(%p)を拒否する', (offset) => {
    expect(listMineQuerySchema.safeParse({ offset }).success).toBe(false)
  })

  test.each(['0', '101', 'abc', '', ' '])('不正なlimit(%p)を拒否する', (limit) => {
    expect(listMineQuerySchema.safeParse({ limit }).success).toBe(false)
  })

  test('未対応のcursor指定を拒否する', () => {
    expect(listMineQuerySchema.safeParse({ cursor: 'abc' }).success).toBe(false)
  })
})
