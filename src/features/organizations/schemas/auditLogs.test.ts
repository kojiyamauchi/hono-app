import { describe, expect, test } from 'bun:test'

import { collectionParamSchema, cursorPayloadSchema, listQuerySchema } from './auditLogs'
import { idParamSchema, POSTGRES_INT_MAX } from './common'

describe('collectionParamSchema', () => {
  test('数値文字列のIDをnumberへ変換する', () => {
    const result = collectionParamSchema.safeParse({ id: '1' })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.id).toBe(1)
    }
  })

  test('PostgreSQL INTEGERの上限（2147483647）ちょうどのIDを受け付ける', () => {
    const result = collectionParamSchema.safeParse({ id: String(POSTGRES_INT_MAX) })

    expect(POSTGRES_INT_MAX).toBe(2147483647)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.id).toBe(2147483647)
    }
  })

  test('上限を超えるIDを拒否する', () => {
    expect(collectionParamSchema.safeParse({ id: '2147483648' }).success).toBe(false)
    expect(collectionParamSchema.safeParse({ id: '9007199254740991' }).success).toBe(false)
  })

  test('1未満のIDと数値ではないIDを拒否する', () => {
    expect(collectionParamSchema.safeParse({ id: '0' }).success).toBe(false)
    expect(collectionParamSchema.safeParse({ id: 'abc' }).success).toBe(false)
  })

  test('既存のidParamSchemaは上限を超えるIDを従来どおり受け付ける（他の組織ルートの仕様を変えない）', () => {
    expect(idParamSchema.safeParse({ id: '2147483648' }).success).toBe(true)
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

describe('cursorPayloadSchema', () => {
  const validPayload = { kind: 'auditLogs', version: 1, organizationId: 1, createdAt: '2026-01-01T00:00:00.000Z', id: 3 }

  test('正しいペイロードを受け付ける', () => {
    expect(cursorPayloadSchema.safeParse(validPayload).success).toBe(true)
  })

  test('kindがない、または別の値なら拒否する（メンバー一覧のカーソルを含む）', () => {
    const { kind: _kind, ...withoutKind } = validPayload

    expect(cursorPayloadSchema.safeParse(withoutKind).success).toBe(false)
    expect(cursorPayloadSchema.safeParse({ ...validPayload, kind: 'members' }).success).toBe(false)
  })

  test('versionが一致しなければ拒否する', () => {
    expect(cursorPayloadSchema.safeParse({ ...validPayload, version: 2 }).success).toBe(false)
  })

  test('organizationIdとidが正の整数でなければ拒否する', () => {
    expect(cursorPayloadSchema.safeParse({ ...validPayload, organizationId: 0 }).success).toBe(false)
    expect(cursorPayloadSchema.safeParse({ ...validPayload, id: 0 }).success).toBe(false)
    expect(cursorPayloadSchema.safeParse({ ...validPayload, id: 1.5 }).success).toBe(false)
  })

  test('organizationIdとidはPostgreSQL INTEGERの上限（2147483647）ちょうどまで受け付ける', () => {
    expect(cursorPayloadSchema.safeParse({ ...validPayload, organizationId: 2147483647 }).success).toBe(true)
    expect(cursorPayloadSchema.safeParse({ ...validPayload, id: 2147483647 }).success).toBe(true)
  })

  test('organizationIdとidが上限を超えていれば拒否する（DBの整数変換で500になるのを防ぐ）', () => {
    expect(cursorPayloadSchema.safeParse({ ...validPayload, organizationId: 2147483648 }).success).toBe(false)
    expect(cursorPayloadSchema.safeParse({ ...validPayload, id: 2147483648 }).success).toBe(false)
  })

  test('日時の形式が不正、またはPostgreSQLで扱えない0年なら拒否する', () => {
    expect(cursorPayloadSchema.safeParse({ ...validPayload, createdAt: 'invalid' }).success).toBe(false)
    expect(cursorPayloadSchema.safeParse({ ...validPayload, createdAt: '0000-01-01T00:00:00.000Z' }).success).toBe(false)
  })
})
