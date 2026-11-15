import { describe, expect, test } from 'bun:test'

import { POSTGRES_INT_MAX } from './common'
import { collectionParamSchema, createBodySchema, cursorPayloadSchema, itemParamSchema, listQuerySchema, updateBodySchema } from './projects'

describe('collectionParamSchema / itemParamSchema', () => {
  test('1以上INTEGER上限以下の整数を受け付け、数値へ変換する', () => {
    expect(collectionParamSchema.safeParse({ id: '1' })).toMatchObject({ success: true, data: { id: 1 } })
    expect(itemParamSchema.safeParse({ id: String(POSTGRES_INT_MAX), projectId: '2' })).toMatchObject({
      success: true,
      data: { id: POSTGRES_INT_MAX, projectId: 2 },
    })
  })

  test.each(['0', '-1', '1.5', 'abc', '', String(POSTGRES_INT_MAX + 1)])('組織IDに不正値 "%s" を拒否する', (id) => {
    expect(collectionParamSchema.safeParse({ id }).success).toBe(false)
  })

  test.each(['0', '-1', '1.5', 'abc', String(POSTGRES_INT_MAX + 1)])('プロジェクトIDに不正値 "%s" を拒否する', (projectId) => {
    expect(itemParamSchema.safeParse({ id: '1', projectId }).success).toBe(false)
  })
})

describe('createBodySchema', () => {
  test('nameのみを受け付け、descriptionは省略のままにする', () => {
    const result = createBodySchema.safeParse({ name: 'Alpha' })
    expect(result).toMatchObject({ success: true, data: { name: 'Alpha' } })
    expect(result.data).not.toHaveProperty('description')
  })

  test('nameの前後の空白を除去する', () => {
    expect(createBodySchema.safeParse({ name: '  Alpha  ' }).data?.name).toBe('Alpha')
  })

  test('nameは1文字と100文字を受け付け、空・空白のみ・101文字を拒否する', () => {
    expect(createBodySchema.safeParse({ name: 'a' }).success).toBe(true)
    expect(createBodySchema.safeParse({ name: 'a'.repeat(100) }).success).toBe(true)
    expect(createBodySchema.safeParse({ name: '' }).success).toBe(false)
    expect(createBodySchema.safeParse({ name: '   ' }).success).toBe(false)
    expect(createBodySchema.safeParse({ name: 'a'.repeat(101) }).success).toBe(false)
    // trim後の長さで判定する
    expect(createBodySchema.safeParse({ name: ` ${'a'.repeat(100)} ` }).success).toBe(true)
  })

  test('nameの省略・null・文字列以外を拒否する', () => {
    expect(createBodySchema.safeParse({}).success).toBe(false)
    expect(createBodySchema.safeParse({ name: null }).success).toBe(false)
    expect(createBodySchema.safeParse({ name: 1 }).success).toBe(false)
  })

  test('descriptionはnull・空文字・空白付き文字列をそのまま受け付ける（trimしない）', () => {
    expect(createBodySchema.safeParse({ name: 'a', description: null }).data?.description).toBeNull()
    expect(createBodySchema.safeParse({ name: 'a', description: '' }).data?.description).toBe('')
    expect(createBodySchema.safeParse({ name: 'a', description: '  text  ' }).data?.description).toBe('  text  ')
  })

  test('descriptionは2000文字を受け付け、2001文字を拒否する', () => {
    expect(createBodySchema.safeParse({ name: 'a', description: 'a'.repeat(2000) }).success).toBe(true)
    expect(createBodySchema.safeParse({ name: 'a', description: 'a'.repeat(2001) }).success).toBe(false)
  })

  test('未知の項目を拒否する', () => {
    for (const extra of [{ id: 1 }, { organizationId: 2 }, { createdAt: '2026-01-01T00:00:00.000Z' }, { updatedAt: '2026-01-01T00:00:00.000Z' }]) {
      expect(createBodySchema.safeParse({ name: 'a', ...extra }).success).toBe(false)
    }
  })

  test('オブジェクト以外を拒否する', () => {
    expect(createBodySchema.safeParse(null).success).toBe(false)
    expect(createBodySchema.safeParse([]).success).toBe(false)
    expect(createBodySchema.safeParse('a').success).toBe(false)
  })
})

describe('updateBodySchema', () => {
  test('nameのみ、descriptionのみ、両方の指定を受け付ける', () => {
    expect(updateBodySchema.safeParse({ name: 'b' }).success).toBe(true)
    expect(updateBodySchema.safeParse({ description: 'text' }).success).toBe(true)
    expect(updateBodySchema.safeParse({ name: 'b', description: null }).success).toBe(true)
  })

  test('description: null と空文字を有効な更新として受け付ける', () => {
    expect(updateBodySchema.safeParse({ description: null })).toMatchObject({ success: true, data: { description: null } })
    expect(updateBodySchema.safeParse({ description: '' })).toMatchObject({ success: true, data: { description: '' } })
  })

  test('空のbodyを拒否する', () => {
    expect(updateBodySchema.safeParse({}).success).toBe(false)
  })

  test('name: null と不正なnameを拒否する', () => {
    expect(updateBodySchema.safeParse({ name: null }).success).toBe(false)
    expect(updateBodySchema.safeParse({ name: '   ' }).success).toBe(false)
    expect(updateBodySchema.safeParse({ name: 'a'.repeat(101) }).success).toBe(false)
  })

  test('未知の項目と文字数超過のdescriptionを拒否する', () => {
    expect(updateBodySchema.safeParse({ name: 'b', organizationId: 2 }).success).toBe(false)
    expect(updateBodySchema.safeParse({ name: 'b', id: 2 }).success).toBe(false)
    expect(updateBodySchema.safeParse({ description: 'a'.repeat(2001) }).success).toBe(false)
  })
})

describe('listQuerySchema', () => {
  test('空のqueryでlimit既定値20を補い、cursorは未指定のままにする', () => {
    const result = listQuerySchema.safeParse({})
    expect(result).toMatchObject({ success: true, data: { limit: 20 } })
    expect(result.data?.cursor).toBeUndefined()
  })

  test('limitは1と100を受け付け、文字列から数値へ変換する', () => {
    expect(listQuerySchema.safeParse({ limit: '1' }).data?.limit).toBe(1)
    expect(listQuerySchema.safeParse({ limit: '100' }).data?.limit).toBe(100)
  })

  test.each(['0', '101', '1.5', 'abc', '', ' '])('limitの不正値 "%s" を拒否する', (limit) => {
    expect(listQuerySchema.safeParse({ limit }).success).toBe(false)
  })

  test('cursorの空文字・空白のみを拒否する', () => {
    expect(listQuerySchema.safeParse({ cursor: '' }).success).toBe(false)
    expect(listQuerySchema.safeParse({ cursor: '  ' }).success).toBe(false)
    expect(listQuerySchema.safeParse({ cursor: 'abc' }).success).toBe(true)
  })

  test('offsetを含む未知のqueryを拒否する', () => {
    expect(listQuerySchema.safeParse({ offset: '0' }).success).toBe(false)
    expect(listQuerySchema.safeParse({ offset: '' }).success).toBe(false)
    expect(listQuerySchema.safeParse({ foo: 'bar' }).success).toBe(false)
  })
})

describe('cursorPayloadSchema', () => {
  const valid = { kind: 'projects', version: 1, organizationId: 1, createdAt: '2026-01-01T00:00:00.000Z', id: 3 }

  test('正しいペイロードを受け付ける', () => {
    expect(cursorPayloadSchema.safeParse(valid).success).toBe(true)
  })

  test('kindの欠落・不一致、未対応versionを拒否する', () => {
    expect(cursorPayloadSchema.safeParse({ ...valid, kind: undefined }).success).toBe(false)
    expect(cursorPayloadSchema.safeParse({ ...valid, kind: 'auditLogs' }).success).toBe(false)
    expect(cursorPayloadSchema.safeParse({ ...valid, version: 2 }).success).toBe(false)
  })

  test('IDの範囲外と、0年の日時を拒否する', () => {
    expect(cursorPayloadSchema.safeParse({ ...valid, id: 0 }).success).toBe(false)
    expect(cursorPayloadSchema.safeParse({ ...valid, id: POSTGRES_INT_MAX + 1 }).success).toBe(false)
    expect(cursorPayloadSchema.safeParse({ ...valid, organizationId: POSTGRES_INT_MAX + 1 }).success).toBe(false)
    expect(cursorPayloadSchema.safeParse({ ...valid, createdAt: '0000-01-01T00:00:00.000Z' }).success).toBe(false)
    expect(cursorPayloadSchema.safeParse({ ...valid, createdAt: 'invalid' }).success).toBe(false)
  })
})
