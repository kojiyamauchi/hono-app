import { describe, expect, test } from 'bun:test'

import { POSTGRES_INT_MAX } from '.'
import {
  createProjectBodySchema,
  listProjectsQuerySchema,
  projectCursorPayloadSchema,
  projectRouteParamSchema,
  projectsRouteParamSchema,
  updateProjectBodySchema,
} from './projects'

describe('projectsRouteParamSchema / projectRouteParamSchema', () => {
  test('1以上INTEGER上限以下の整数を受け付け、数値へ変換する', () => {
    expect(projectsRouteParamSchema.safeParse({ id: '1' })).toMatchObject({ success: true, data: { id: 1 } })
    expect(projectRouteParamSchema.safeParse({ id: String(POSTGRES_INT_MAX), projectId: '2' })).toMatchObject({
      success: true,
      data: { id: POSTGRES_INT_MAX, projectId: 2 },
    })
  })

  test.each(['0', '-1', '1.5', 'abc', '', String(POSTGRES_INT_MAX + 1)])('組織IDに不正値 "%s" を拒否する', (id) => {
    expect(projectsRouteParamSchema.safeParse({ id }).success).toBe(false)
  })

  test.each(['0', '-1', '1.5', 'abc', String(POSTGRES_INT_MAX + 1)])('プロジェクトIDに不正値 "%s" を拒否する', (projectId) => {
    expect(projectRouteParamSchema.safeParse({ id: '1', projectId }).success).toBe(false)
  })
})

describe('createProjectBodySchema', () => {
  test('nameのみを受け付け、descriptionは省略のままにする', () => {
    const result = createProjectBodySchema.safeParse({ name: 'Alpha' })
    expect(result).toMatchObject({ success: true, data: { name: 'Alpha' } })
    expect(result.data).not.toHaveProperty('description')
  })

  test('nameの前後の空白を除去する', () => {
    expect(createProjectBodySchema.safeParse({ name: '  Alpha  ' }).data?.name).toBe('Alpha')
  })

  test('nameは1文字と100文字を受け付け、空・空白のみ・101文字を拒否する', () => {
    expect(createProjectBodySchema.safeParse({ name: 'a' }).success).toBe(true)
    expect(createProjectBodySchema.safeParse({ name: 'a'.repeat(100) }).success).toBe(true)
    expect(createProjectBodySchema.safeParse({ name: '' }).success).toBe(false)
    expect(createProjectBodySchema.safeParse({ name: '   ' }).success).toBe(false)
    expect(createProjectBodySchema.safeParse({ name: 'a'.repeat(101) }).success).toBe(false)
    // trim後の長さで判定する
    expect(createProjectBodySchema.safeParse({ name: ` ${'a'.repeat(100)} ` }).success).toBe(true)
  })

  test('nameの省略・null・文字列以外を拒否する', () => {
    expect(createProjectBodySchema.safeParse({}).success).toBe(false)
    expect(createProjectBodySchema.safeParse({ name: null }).success).toBe(false)
    expect(createProjectBodySchema.safeParse({ name: 1 }).success).toBe(false)
  })

  test('descriptionはnull・空文字・空白付き文字列をそのまま受け付ける（trimしない）', () => {
    expect(createProjectBodySchema.safeParse({ name: 'a', description: null }).data?.description).toBeNull()
    expect(createProjectBodySchema.safeParse({ name: 'a', description: '' }).data?.description).toBe('')
    expect(createProjectBodySchema.safeParse({ name: 'a', description: '  text  ' }).data?.description).toBe('  text  ')
  })

  test('descriptionは2000文字を受け付け、2001文字を拒否する', () => {
    expect(createProjectBodySchema.safeParse({ name: 'a', description: 'a'.repeat(2000) }).success).toBe(true)
    expect(createProjectBodySchema.safeParse({ name: 'a', description: 'a'.repeat(2001) }).success).toBe(false)
  })

  test('未知の項目を拒否する', () => {
    for (const extra of [{ id: 1 }, { organizationId: 2 }, { createdAt: '2026-01-01T00:00:00.000Z' }, { updatedAt: '2026-01-01T00:00:00.000Z' }]) {
      expect(createProjectBodySchema.safeParse({ name: 'a', ...extra }).success).toBe(false)
    }
  })

  test('オブジェクト以外を拒否する', () => {
    expect(createProjectBodySchema.safeParse(null).success).toBe(false)
    expect(createProjectBodySchema.safeParse([]).success).toBe(false)
    expect(createProjectBodySchema.safeParse('a').success).toBe(false)
  })
})

describe('updateProjectBodySchema', () => {
  test('nameのみ、descriptionのみ、両方の指定を受け付ける', () => {
    expect(updateProjectBodySchema.safeParse({ name: 'b' }).success).toBe(true)
    expect(updateProjectBodySchema.safeParse({ description: 'text' }).success).toBe(true)
    expect(updateProjectBodySchema.safeParse({ name: 'b', description: null }).success).toBe(true)
  })

  test('description: null と空文字を有効な更新として受け付ける', () => {
    expect(updateProjectBodySchema.safeParse({ description: null })).toMatchObject({ success: true, data: { description: null } })
    expect(updateProjectBodySchema.safeParse({ description: '' })).toMatchObject({ success: true, data: { description: '' } })
  })

  test('空のbodyを拒否する', () => {
    expect(updateProjectBodySchema.safeParse({}).success).toBe(false)
  })

  test('name: null と不正なnameを拒否する', () => {
    expect(updateProjectBodySchema.safeParse({ name: null }).success).toBe(false)
    expect(updateProjectBodySchema.safeParse({ name: '   ' }).success).toBe(false)
    expect(updateProjectBodySchema.safeParse({ name: 'a'.repeat(101) }).success).toBe(false)
  })

  test('未知の項目と文字数超過のdescriptionを拒否する', () => {
    expect(updateProjectBodySchema.safeParse({ name: 'b', organizationId: 2 }).success).toBe(false)
    expect(updateProjectBodySchema.safeParse({ name: 'b', id: 2 }).success).toBe(false)
    expect(updateProjectBodySchema.safeParse({ description: 'a'.repeat(2001) }).success).toBe(false)
  })
})

describe('listProjectsQuerySchema', () => {
  test('空のqueryでlimit既定値20を補い、cursorは未指定のままにする', () => {
    const result = listProjectsQuerySchema.safeParse({})
    expect(result).toMatchObject({ success: true, data: { limit: 20 } })
    expect(result.data?.cursor).toBeUndefined()
  })

  test('limitは1と100を受け付け、文字列から数値へ変換する', () => {
    expect(listProjectsQuerySchema.safeParse({ limit: '1' }).data?.limit).toBe(1)
    expect(listProjectsQuerySchema.safeParse({ limit: '100' }).data?.limit).toBe(100)
  })

  test.each(['0', '101', '1.5', 'abc', '', ' '])('limitの不正値 "%s" を拒否する', (limit) => {
    expect(listProjectsQuerySchema.safeParse({ limit }).success).toBe(false)
  })

  test('cursorの空文字・空白のみを拒否する', () => {
    expect(listProjectsQuerySchema.safeParse({ cursor: '' }).success).toBe(false)
    expect(listProjectsQuerySchema.safeParse({ cursor: '  ' }).success).toBe(false)
    expect(listProjectsQuerySchema.safeParse({ cursor: 'abc' }).success).toBe(true)
  })

  test('offsetを含む未知のqueryを拒否する', () => {
    expect(listProjectsQuerySchema.safeParse({ offset: '0' }).success).toBe(false)
    expect(listProjectsQuerySchema.safeParse({ offset: '' }).success).toBe(false)
    expect(listProjectsQuerySchema.safeParse({ foo: 'bar' }).success).toBe(false)
  })
})

describe('projectCursorPayloadSchema', () => {
  const valid = { kind: 'projects', version: 1, organizationId: 1, createdAt: '2026-01-01T00:00:00.000Z', id: 3 }

  test('正しいペイロードを受け付ける', () => {
    expect(projectCursorPayloadSchema.safeParse(valid).success).toBe(true)
  })

  test('kindの欠落・不一致、未対応versionを拒否する', () => {
    expect(projectCursorPayloadSchema.safeParse({ ...valid, kind: undefined }).success).toBe(false)
    expect(projectCursorPayloadSchema.safeParse({ ...valid, kind: 'auditLogs' }).success).toBe(false)
    expect(projectCursorPayloadSchema.safeParse({ ...valid, version: 2 }).success).toBe(false)
  })

  test('IDの範囲外と、0年の日時を拒否する', () => {
    expect(projectCursorPayloadSchema.safeParse({ ...valid, id: 0 }).success).toBe(false)
    expect(projectCursorPayloadSchema.safeParse({ ...valid, id: POSTGRES_INT_MAX + 1 }).success).toBe(false)
    expect(projectCursorPayloadSchema.safeParse({ ...valid, organizationId: POSTGRES_INT_MAX + 1 }).success).toBe(false)
    expect(projectCursorPayloadSchema.safeParse({ ...valid, createdAt: '0000-01-01T00:00:00.000Z' }).success).toBe(false)
    expect(projectCursorPayloadSchema.safeParse({ ...valid, createdAt: 'invalid' }).success).toBe(false)
  })
})
