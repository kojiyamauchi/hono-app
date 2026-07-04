import { describe, expect, test } from 'bun:test'

import { authSubjectSchema } from '.'

describe('authSubjectSchema', () => {
  test('正の整数（number）は通し、数値として取り出せる', () => {
    const result = authSubjectSchema.safeParse(1)

    expect(result.success).toBe(true)
    expect(result.data).toBe(1)
  })

  test('10進の正の整数文字列は通し、numberへ変換される', () => {
    const result = authSubjectSchema.safeParse('42')

    expect(result.success).toBe(true)
    expect(result.data).toBe(42)
  })

  test.each([
    ['0', 0],
    ['負数', -1],
    ['小数', 1.5],
    ['NaN', NaN],
    ['boolean', true],
    ['配列(数値)', [1]],
    ['配列(文字列)', ['1']],
    ['undefined', undefined],
    ['null', null],
    ['空文字', ''],
    ['非数値文字列', 'abc'],
    ['指数表記文字列', '1e2'],
    ['小数表記文字列', '1.0'],
    ['16進表記文字列', '0x1'],
    ['前ゼロ付き文字列', '01'],
    ['前後空白付き文字列', ' 1 '],
  ])('%s は弾く', (_label, input) => {
    expect(authSubjectSchema.safeParse(input).success).toBe(false)
  })

  test('安全整数の範囲を超えるnumberは弾く', () => {
    expect(authSubjectSchema.safeParse(Number.MAX_SAFE_INTEGER + 1).success).toBe(false)
  })
})
