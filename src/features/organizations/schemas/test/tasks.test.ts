import { describe, expect, test } from 'bun:test'

import { POSTGRES_INT_MAX } from '../common'
import { collectionParamSchema, createBodySchema, cursorPayloadSchema, itemParamSchema, listQuerySchema, updateBodySchema } from '../tasks'

describe('collectionParamSchema / itemParamSchema', () => {
  test('1以上INTEGER上限以下の整数を受け付け、数値へ変換する', () => {
    expect(collectionParamSchema.safeParse({ id: '1', projectId: '2' })).toMatchObject({ success: true, data: { id: 1, projectId: 2 } })
    expect(itemParamSchema.safeParse({ id: String(POSTGRES_INT_MAX), projectId: '2', taskId: String(POSTGRES_INT_MAX) })).toMatchObject({
      success: true,
      data: { id: POSTGRES_INT_MAX, projectId: 2, taskId: POSTGRES_INT_MAX },
    })
  })

  test.each(['0', '-1', '1.5', 'abc', '', String(POSTGRES_INT_MAX + 1)])('各IDに不正値 "%s" を拒否する', (value) => {
    expect(collectionParamSchema.safeParse({ id: value, projectId: '1' }).success).toBe(false)
    expect(collectionParamSchema.safeParse({ id: '1', projectId: value }).success).toBe(false)
    expect(itemParamSchema.safeParse({ id: '1', projectId: '1', taskId: value }).success).toBe(false)
  })
})

describe('createBodySchema', () => {
  test('titleのみを受け付け、descriptionとstatusは省略のままにする', () => {
    const result = createBodySchema.safeParse({ title: 'Task' })
    expect(result).toMatchObject({ success: true, data: { title: 'Task' } })
    expect(result.data).not.toHaveProperty('description')
    expect(result.data).not.toHaveProperty('status')
  })

  test('titleの前後の空白を除去し、1〜200文字をtrim後の長さで判定する', () => {
    expect(createBodySchema.safeParse({ title: '  Task  ' }).data?.title).toBe('Task')
    expect(createBodySchema.safeParse({ title: 'a'.repeat(200) }).success).toBe(true)
    expect(createBodySchema.safeParse({ title: ` ${'a'.repeat(200)} ` }).success).toBe(true)
    for (const title of ['', '   ', 'a'.repeat(201)]) {
      expect(createBodySchema.safeParse({ title }).success).toBe(false)
    }
  })

  test('titleの省略・null・文字列以外を拒否する', () => {
    expect(createBodySchema.safeParse({}).success).toBe(false)
    expect(createBodySchema.safeParse({ title: null }).success).toBe(false)
    expect(createBodySchema.safeParse({ title: 1 }).success).toBe(false)
  })

  test('descriptionはnull・空文字・空白付き文字列をそのまま受け付け（trimしない）、2000文字まで', () => {
    expect(createBodySchema.safeParse({ title: 'a', description: null }).data?.description).toBeNull()
    expect(createBodySchema.safeParse({ title: 'a', description: '' }).data?.description).toBe('')
    expect(createBodySchema.safeParse({ title: 'a', description: '  text  ' }).data?.description).toBe('  text  ')
    expect(createBodySchema.safeParse({ title: 'a', description: 'a'.repeat(2000) }).success).toBe(true)
    expect(createBodySchema.safeParse({ title: 'a', description: 'a'.repeat(2001) }).success).toBe(false)
  })

  test.each(['TODO', 'IN_PROGRESS', 'DONE'])('作成時にstatus %s を指定できる', (status) => {
    expect(createBodySchema.safeParse({ title: 'a', status }).data?.status).toBe(status)
  })

  test('statusのnull・不明な値・空文字を拒否する', () => {
    for (const status of [null, 'todo', 'CLOSED', '']) {
      expect(createBodySchema.safeParse({ title: 'a', status }).success).toBe(false)
    }
  })

  test('未知の項目を拒否する', () => {
    for (const extra of [{ id: 1 }, { projectId: 2 }, { organizationId: 2 }, { createdAt: '2026-01-01T00:00:00.000Z' }, { createdBy: 1 }]) {
      expect(createBodySchema.safeParse({ title: 'a', ...extra }).success).toBe(false)
    }
  })

  test('オブジェクト以外を拒否する', () => {
    expect(createBodySchema.safeParse(null).success).toBe(false)
    expect(createBodySchema.safeParse([]).success).toBe(false)
    expect(createBodySchema.safeParse('a').success).toBe(false)
  })
})

describe('updateBodySchema', () => {
  test('title・description・statusのいずれか単独、または組み合わせの指定を受け付ける', () => {
    expect(updateBodySchema.safeParse({ title: 'b' }).success).toBe(true)
    expect(updateBodySchema.safeParse({ description: 'text' }).success).toBe(true)
    expect(updateBodySchema.safeParse({ status: 'DONE' }).success).toBe(true)
    expect(updateBodySchema.safeParse({ title: 'b', description: null, status: 'TODO' }).success).toBe(true)
  })

  test('description: null と空文字を有効な更新として受け付ける', () => {
    expect(updateBodySchema.safeParse({ description: null })).toMatchObject({ success: true, data: { description: null } })
    expect(updateBodySchema.safeParse({ description: '' })).toMatchObject({ success: true, data: { description: '' } })
  })

  test('空のbodyを拒否する', () => {
    expect(updateBodySchema.safeParse({}).success).toBe(false)
  })

  test('title: null・status: null と不正な値を拒否する', () => {
    expect(updateBodySchema.safeParse({ title: null }).success).toBe(false)
    expect(updateBodySchema.safeParse({ title: '   ' }).success).toBe(false)
    expect(updateBodySchema.safeParse({ title: 'a'.repeat(201) }).success).toBe(false)
    expect(updateBodySchema.safeParse({ status: null }).success).toBe(false)
    expect(updateBodySchema.safeParse({ status: 'CLOSED' }).success).toBe(false)
    expect(updateBodySchema.safeParse({ description: 'a'.repeat(2001) }).success).toBe(false)
  })

  test('未知の項目を拒否する', () => {
    expect(updateBodySchema.safeParse({ title: 'b', projectId: 2 }).success).toBe(false)
    expect(updateBodySchema.safeParse({ title: 'b', id: 2 }).success).toBe(false)
    expect(updateBodySchema.safeParse({ title: 'b', updatedAt: '2026-01-01T00:00:00.000Z' }).success).toBe(false)
  })
})

describe('listQuerySchema', () => {
  test('空のqueryでlimit既定値20を補い、cursorとstatusは未指定のままにする', () => {
    const result = listQuerySchema.safeParse({})
    expect(result).toMatchObject({ success: true, data: { limit: 20 } })
    expect(result.data?.cursor).toBeUndefined()
    expect(result.data?.status).toBeUndefined()
  })

  test('limitは1と100を受け付け、不正値を拒否する', () => {
    expect(listQuerySchema.safeParse({ limit: '1' }).data?.limit).toBe(1)
    expect(listQuerySchema.safeParse({ limit: '100' }).data?.limit).toBe(100)
    for (const limit of ['0', '101', '1.5', 'abc', '', ' ']) {
      expect(listQuerySchema.safeParse({ limit }).success).toBe(false)
    }
  })

  test('cursorの空文字・空白のみを拒否する', () => {
    expect(listQuerySchema.safeParse({ cursor: '' }).success).toBe(false)
    expect(listQuerySchema.safeParse({ cursor: '  ' }).success).toBe(false)
    expect(listQuerySchema.safeParse({ cursor: 'abc' }).success).toBe(true)
  })

  test.each(['TODO', 'IN_PROGRESS', 'DONE'])('statusに %s を受け付ける', (status) => {
    expect(listQuerySchema.safeParse({ status }).data?.status).toBe(status)
  })

  test('statusの空文字・不明な状態・小文字を拒否する', () => {
    for (const status of ['', ' ', 'todo', 'CLOSED', 'TODO,DONE']) {
      expect(listQuerySchema.safeParse({ status }).success).toBe(false)
    }
  })

  test('offsetを含む未知のqueryを拒否する', () => {
    expect(listQuerySchema.safeParse({ offset: '0' }).success).toBe(false)
    expect(listQuerySchema.safeParse({ offset: '' }).success).toBe(false)
    expect(listQuerySchema.safeParse({ foo: 'bar' }).success).toBe(false)
  })
})

describe('cursorPayloadSchema', () => {
  const valid = { kind: 'tasks', version: 1, organizationId: 1, projectId: 2, status: null, createdAt: '2026-01-01T00:00:00.000Z', id: 3 }

  test('statusがnullまたは3状態のペイロードを受け付ける', () => {
    expect(cursorPayloadSchema.safeParse(valid).success).toBe(true)
    expect(cursorPayloadSchema.safeParse({ ...valid, status: 'DONE' }).success).toBe(true)
  })

  test('kindの欠落・不一致、未対応version、statusの欠落・不正値を拒否する', () => {
    expect(cursorPayloadSchema.safeParse({ ...valid, kind: undefined }).success).toBe(false)
    expect(cursorPayloadSchema.safeParse({ ...valid, kind: 'projects' }).success).toBe(false)
    expect(cursorPayloadSchema.safeParse({ ...valid, version: 2 }).success).toBe(false)
    expect(cursorPayloadSchema.safeParse({ ...valid, status: undefined }).success).toBe(false)
    expect(cursorPayloadSchema.safeParse({ ...valid, status: 'CLOSED' }).success).toBe(false)
  })

  test('IDの範囲外と、0年の日時を拒否する', () => {
    for (const key of ['id', 'organizationId', 'projectId']) {
      expect(cursorPayloadSchema.safeParse({ ...valid, [key]: 0 }).success).toBe(false)
      expect(cursorPayloadSchema.safeParse({ ...valid, [key]: POSTGRES_INT_MAX + 1 }).success).toBe(false)
    }
    expect(cursorPayloadSchema.safeParse({ ...valid, createdAt: '0000-01-01T00:00:00.000Z' }).success).toBe(false)
    expect(cursorPayloadSchema.safeParse({ ...valid, createdAt: 'invalid' }).success).toBe(false)
  })
})
