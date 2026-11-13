import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { Role } from '@/shared/membership/entities'
import type { AppError } from '@/utils/errors'

import type { Project } from '../entities/projects'
import { encodeProjectCursor } from '../mappers/projects'

const findPageByOrganization = mock()
const findByOrganizationAndId = mock()
const createWithAuthorization = mock()
const updateWithAuthorization = mock()
const removeWithAuthorization = mock()

await mock.module('@/features/organizations/repositories/projects', () => ({
  projectRepository: { findPageByOrganization, findByOrganizationAndId, createWithAuthorization, updateWithAuthorization, removeWithAuthorization },
  projectWriteResults: {
    succeeded: 'SUCCEEDED',
    organizationNotFound: 'ORGANIZATION_NOT_FOUND',
    projectNotFound: 'PROJECT_NOT_FOUND',
    rejected: 'REJECTED',
  },
}))

const { projectsService } = await import('./projects')

const makeProject = (id: number, createdAt = '2026-01-01T00:00:00.000Z'): Project => ({
  id,
  organizationId: 1,
  name: `Project ${id}`,
  description: null,
  createdAt: new Date(createdAt),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
})

/** repositoryへ渡された認可コールバックを、指定ロールで実行して結果を返す。 */
const runAuthorize = (mockFn: ReturnType<typeof mock>, role: Role): AppError | null => {
  const authorize = mockFn.mock.calls[0]?.[1] as (state: { operatorRole: Role }) => AppError | null
  return authorize({ operatorRole: role })
}

describe('projectsService.list', () => {
  beforeEach(() => {
    findPageByOrganization.mockReset()
  })

  test('limit + 1 件を取得し、後続があればlimit件に切り詰めてnextCursorを発行する', async () => {
    findPageByOrganization.mockResolvedValue([makeProject(3), makeProject(2), makeProject(1)])

    const result = await projectsService.list(1, 2)

    expect(findPageByOrganization).toHaveBeenCalledWith(1, 3, null)
    expect(result.items.map((item) => item.id)).toEqual([3, 2])
    expect(result.nextCursor).toBe(encodeProjectCursor({ organizationId: 1, createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 2 }))
  })

  test('最終ページと0件ではnextCursorをnullで返す', async () => {
    findPageByOrganization.mockResolvedValue([makeProject(2), makeProject(1)])
    expect(await projectsService.list(1, 2)).toMatchObject({ items: [{ id: 2 }, { id: 1 }], nextCursor: null })

    findPageByOrganization.mockResolvedValue([])
    expect(await projectsService.list(1, 2)).toEqual({ items: [], nextCursor: null })
  })

  test('カーソルの境界値をrepositoryへ渡す', async () => {
    findPageByOrganization.mockResolvedValue([])
    const createdAt = new Date('2026-03-04T05:06:07.890Z')

    await projectsService.list(1, 20, encodeProjectCursor({ organizationId: 1, createdAt, id: 9 }))

    expect(findPageByOrganization).toHaveBeenCalledWith(1, 21, { createdAt, id: 9 })
  })

  test('不正形式・別組織・別kind・未対応versionのカーソルは400で、repositoryへ進まない', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z')
    const otherKind = Buffer.from(JSON.stringify({ kind: 'auditLogs', version: 1, organizationId: 1, createdAt: createdAt.toISOString(), id: 1 })).toString(
      'base64url',
    )
    const otherVersion = Buffer.from(JSON.stringify({ kind: 'projects', version: 2, organizationId: 1, createdAt: createdAt.toISOString(), id: 1 })).toString(
      'base64url',
    )

    for (const cursor of ['invalid', otherKind, otherVersion, encodeProjectCursor({ organizationId: 2, createdAt, id: 1 })]) {
      await expect(projectsService.list(1, 20, cursor)).rejects.toMatchObject({ statusCode: 400, message: 'カーソルが不正です' })
    }
    expect(findPageByOrganization).not.toHaveBeenCalled()
  })
})

describe('projectsService.getById', () => {
  beforeEach(() => {
    findByOrganizationAndId.mockReset()
  })

  test('組織IDとプロジェクトIDで取得してDTOへ変換する', async () => {
    findByOrganizationAndId.mockResolvedValue(makeProject(5))

    const result = await projectsService.getById(1, 5)

    expect(findByOrganizationAndId).toHaveBeenCalledWith(1, 5)
    expect(result).toMatchObject({ id: 5, organizationId: 1, description: null, createdAt: '2026-01-01T00:00:00.000Z' })
  })

  test('存在しなければ404', async () => {
    findByOrganizationAndId.mockResolvedValue(null)

    await expect(projectsService.getById(1, 5)).rejects.toMatchObject({ statusCode: 404, message: 'プロジェクトが見つかりません' })
  })
})

describe('projectsService.create', () => {
  beforeEach(() => {
    createWithAuthorization.mockReset()
  })

  test('省略された説明はnullとして保存し、作成結果をDTOで返す', async () => {
    createWithAuthorization.mockResolvedValue({ status: 'SUCCEEDED', value: makeProject(5) })

    const result = await projectsService.create(1, 3, { name: 'Alpha' })

    expect(createWithAuthorization.mock.calls[0]?.[0]).toEqual({ organizationId: 1, actorUserId: 3, name: 'Alpha', description: null })
    expect(result.id).toBe(5)
  })

  test('空文字の説明はそのまま保存する', async () => {
    createWithAuthorization.mockResolvedValue({ status: 'SUCCEEDED', value: makeProject(5) })

    await projectsService.create(1, 3, { name: 'Alpha', description: '' })

    expect(createWithAuthorization.mock.calls[0]?.[0]).toMatchObject({ description: '' })
  })

  test('認可コールバックはOWNER / ADMINを許可し、MEMBERを403で拒否する', async () => {
    createWithAuthorization.mockResolvedValue({ status: 'SUCCEEDED', value: makeProject(5) })
    await projectsService.create(1, 3, { name: 'Alpha' })

    expect(runAuthorize(createWithAuthorization, 'OWNER')).toBeNull()
    expect(runAuthorize(createWithAuthorization, 'ADMIN')).toBeNull()
    expect(runAuthorize(createWithAuthorization, 'MEMBER')).toMatchObject({ statusCode: 403 })
  })

  test.each([
    [{ status: 'ORGANIZATION_NOT_FOUND' }, 404, '組織が見つかりません'],
    [{ status: 'PROJECT_NOT_FOUND' }, 404, 'プロジェクトが見つかりません'],
  ])('repositoryの失敗結果 %j をHTTPエラーへ変換する', async (repositoryResult, statusCode, message) => {
    createWithAuthorization.mockResolvedValue(repositoryResult)

    await expect(projectsService.create(1, 3, { name: 'Alpha' })).rejects.toMatchObject({ statusCode, message })
  })

  test('拒否結果は認可コールバックが返したAppErrorをそのままthrowする', async () => {
    const { AppError } = await import('@/utils/errors')
    createWithAuthorization.mockResolvedValue({ status: 'REJECTED', rejection: new AppError(403, '拒否') })

    await expect(projectsService.create(1, 3, { name: 'Alpha' })).rejects.toMatchObject({ statusCode: 403, message: '拒否' })
  })

  test('未知の結果は暗黙の成功にせず、想定外のエラーとしてthrowする', async () => {
    createWithAuthorization.mockResolvedValue({ status: 'UNKNOWN' })

    await expect(projectsService.create(1, 3, { name: 'Alpha' })).rejects.toThrow('プロジェクト操作の結果が不明です')
  })

  test('repositoryの例外はそのままthrowする', async () => {
    createWithAuthorization.mockRejectedValue(new Error('INSERT失敗'))

    await expect(projectsService.create(1, 3, { name: 'Alpha' })).rejects.toThrow('INSERT失敗')
  })
})

describe('projectsService.update', () => {
  beforeEach(() => {
    updateWithAuthorization.mockReset()
  })

  test('指定された項目だけをrepositoryへ渡し、更新結果をDTOで返す', async () => {
    updateWithAuthorization.mockResolvedValue({ status: 'SUCCEEDED', value: makeProject(5) })

    await projectsService.update(1, 5, 3, { name: 'Beta' })
    expect(updateWithAuthorization.mock.calls[0]?.[0]).toEqual({ organizationId: 1, projectId: 5, actorUserId: 3, data: { name: 'Beta' } })

    updateWithAuthorization.mockClear()
    const result = await projectsService.update(1, 5, 3, { description: null })
    expect(updateWithAuthorization.mock.calls[0]?.[0]).toEqual({ organizationId: 1, projectId: 5, actorUserId: 3, data: { description: null } })
    expect(result.id).toBe(5)
  })

  test('認可コールバックはMEMBERを403で拒否する', async () => {
    updateWithAuthorization.mockResolvedValue({ status: 'SUCCEEDED', value: makeProject(5) })
    await projectsService.update(1, 5, 3, { name: 'Beta' })

    expect(runAuthorize(updateWithAuthorization, 'ADMIN')).toBeNull()
    expect(runAuthorize(updateWithAuthorization, 'MEMBER')).toMatchObject({ statusCode: 403 })
  })

  test('組織・プロジェクトが見つからない結果は404、未知の結果は想定外のエラー', async () => {
    updateWithAuthorization.mockResolvedValue({ status: 'ORGANIZATION_NOT_FOUND' })
    await expect(projectsService.update(1, 5, 3, { name: 'B' })).rejects.toMatchObject({ statusCode: 404, message: '組織が見つかりません' })

    updateWithAuthorization.mockResolvedValue({ status: 'PROJECT_NOT_FOUND' })
    await expect(projectsService.update(1, 5, 3, { name: 'B' })).rejects.toMatchObject({ statusCode: 404, message: 'プロジェクトが見つかりません' })

    updateWithAuthorization.mockResolvedValue({ status: 'UNKNOWN' })
    await expect(projectsService.update(1, 5, 3, { name: 'B' })).rejects.toThrow('プロジェクト操作の結果が不明です')
  })
})

describe('projectsService.remove', () => {
  beforeEach(() => {
    removeWithAuthorization.mockReset()
  })

  test('削除に成功したら何も返さない', async () => {
    removeWithAuthorization.mockResolvedValue({ status: 'SUCCEEDED', value: null })

    await expect(projectsService.remove(1, 5, 3)).resolves.toBeUndefined()
    expect(removeWithAuthorization.mock.calls[0]?.[0]).toEqual({ organizationId: 1, projectId: 5, actorUserId: 3 })
  })

  test('認可コールバックはMEMBERを403で拒否する', async () => {
    removeWithAuthorization.mockResolvedValue({ status: 'SUCCEEDED', value: null })
    await projectsService.remove(1, 5, 3)

    expect(runAuthorize(removeWithAuthorization, 'OWNER')).toBeNull()
    expect(runAuthorize(removeWithAuthorization, 'MEMBER')).toMatchObject({ statusCode: 403 })
  })

  test('組織・プロジェクトが見つからない結果は404、未知の結果は想定外のエラー', async () => {
    removeWithAuthorization.mockResolvedValue({ status: 'ORGANIZATION_NOT_FOUND' })
    await expect(projectsService.remove(1, 5, 3)).rejects.toMatchObject({ statusCode: 404, message: '組織が見つかりません' })

    removeWithAuthorization.mockResolvedValue({ status: 'PROJECT_NOT_FOUND' })
    await expect(projectsService.remove(1, 5, 3)).rejects.toMatchObject({ statusCode: 404, message: 'プロジェクトが見つかりません' })

    removeWithAuthorization.mockResolvedValue({ status: 'UNKNOWN' })
    await expect(projectsService.remove(1, 5, 3)).rejects.toThrow('プロジェクト操作の結果が不明です')
  })
})
