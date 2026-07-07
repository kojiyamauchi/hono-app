import { describe, expect, test } from 'bun:test'

import { errorResponseDto } from '.'

describe('errorResponseDto', () => {
  test('統一エラー形式 { error: { message } } をparseできる', () => {
    const result = errorResponseDto.safeParse({ error: { message: 'エラーが発生しました' } })

    expect(result.success).toBe(true)
  })

  test('errorキーが欠けている場合はparseに失敗する', () => {
    const result = errorResponseDto.safeParse({ message: 'エラーが発生しました' })

    expect(result.success).toBe(false)
  })

  test('messageが文字列でない場合はparseに失敗する', () => {
    const result = errorResponseDto.safeParse({ error: { message: 123 } })

    expect(result.success).toBe(false)
  })
})
