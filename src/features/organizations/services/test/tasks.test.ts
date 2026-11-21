import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { Role } from '@/shared/membership/entities'
import { AppError } from '@/utils/errors'

import { itemDto, listDto } from '../../dtos/tasks'
import type { Task } from '../../entities/tasks'
import { encodeTaskCursor } from '../../mappers/tasks'

const projectExists = mock()
const list = mock()
const getById = mock()
const create = mock()
const update = mock()
const remove = mock()

await mock.module('@/features/organizations/repositories/tasks', () => ({
  tasksRepository: { projectExists, list, getById, create, update, remove },
  taskWriteResults: {
    succeeded: 'SUCCEEDED',
    organizationNotFound: 'ORGANIZATION_NOT_FOUND',
    projectNotFound: 'PROJECT_NOT_FOUND',
    taskNotFound: 'TASK_NOT_FOUND',
    rejected: 'REJECTED',
  },
}))

const { tasksService } = await import('../tasks')

const makeTask = (id: number, overrides: Partial<Task> = {}): Task => ({
  id,
  projectId: 7,
  title: `Task ${id}`,
  description: null,
  status: 'TODO',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  ...overrides,
})

/** repositoryへ渡された認可コールバックを、指定ロールで実行して結果を返す。 */
const runAuthorize = (mockFn: ReturnType<typeof mock>, role: Role): AppError | null => {
  const authorize = mockFn.mock.calls[0]?.[1] as (state: { operatorRole: Role }) => AppError | null
  return authorize({ operatorRole: role })
}

const boundaryCursor = (overrides: Record<string, unknown> = {}): string =>
  encodeTaskCursor({ organizationId: 1, projectId: 7, status: null, createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 2, ...overrides } as Parameters<
    typeof encodeTaskCursor
  >[0])

describe('tasksService.list', () => {
  beforeEach(() => {
    projectExists.mockReset()
    list.mockReset()
    projectExists.mockResolvedValue(true)
  })

  test('limit + 1 件を取得し、後続があればlimit件に切り詰めてnextCursorを発行する', async () => {
    list.mockResolvedValue([makeTask(3), makeTask(2), makeTask(1)])

    const result = await tasksService.list(1, 7, 2)

    expect(list).toHaveBeenCalledWith(1, 7, null, 3, null)
    expect(result.items.map((item) => item.id)).toEqual([3, 2])
    expect(result.nextCursor).toBe(boundaryCursor({ createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 2 }))
    expect(listDto.safeParse(result).success).toBe(true)
  })

  test('最終ページと0件ではnextCursorをnullで返す', async () => {
    list.mockResolvedValue([makeTask(2), makeTask(1)])
    expect(await tasksService.list(1, 7, 2)).toMatchObject({ items: [{ id: 2 }, { id: 1 }], nextCursor: null })

    list.mockResolvedValue([])
    expect(await tasksService.list(1, 7, 2)).toEqual({ items: [], nextCursor: null })
  })

  test('状態フィルターをrepositoryへ渡し、発行するカーソルにも状態を含める', async () => {
    list.mockResolvedValue([makeTask(3, { status: 'DONE' }), makeTask(2, { status: 'DONE' })])

    const result = await tasksService.list(1, 7, 1, 'DONE')

    expect(list).toHaveBeenCalledWith(1, 7, 'DONE', 2, null)
    expect(result.nextCursor).toBe(boundaryCursor({ status: 'DONE', id: 3 }))
  })

  test('カーソルの境界値をrepositoryへ渡す（基準行の存在に依存しない）', async () => {
    list.mockResolvedValue([])

    await tasksService.list(1, 7, 20, undefined, boundaryCursor())

    expect(list).toHaveBeenCalledWith(1, 7, null, 21, { createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 2 })
  })

  test('3状態それぞれのカーソルを同じ状態フィルターで受け付ける', async () => {
    list.mockResolvedValue([])
    for (const status of ['TODO', 'IN_PROGRESS', 'DONE'] as const) {
      await tasksService.list(1, 7, 20, status, boundaryCursor({ status }))
    }
    expect(list).toHaveBeenCalledTimes(3)
  })

  test.each([
    ['別組織のカーソル', boundaryCursor({ organizationId: 2 }), undefined],
    ['同一組織の別プロジェクトのカーソル', boundaryCursor({ projectId: 8 }), undefined],
    ['状態フィルター未指定のカーソルを状態指定で使用', boundaryCursor(), 'DONE' as const],
    ['状態指定のカーソルを状態未指定で使用', boundaryCursor({ status: 'DONE' }), undefined],
    ['異なる状態フィルターのカーソル', boundaryCursor({ status: 'TODO' }), 'DONE' as const],
    ['形式が不正', 'not-a-cursor', undefined],
  ])('カーソルが不正なら400を返し、DBへ問い合わせない: %s', async (_name, cursor, status) => {
    await expect(tasksService.list(1, 7, 20, status, cursor)).rejects.toMatchObject({ statusCode: 400 })
    expect(projectExists).not.toHaveBeenCalled()
    expect(list).not.toHaveBeenCalled()
  })

  test('kind・versionが一致しないカーソル（他APIのカーソル）は400を返す', async () => {
    const encode = (payload: Record<string, unknown>): string => Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
    const base = { kind: 'tasks', version: 1, organizationId: 1, projectId: 7, status: null, createdAt: '2026-01-01T00:00:00.000Z', id: 2 }

    for (const payload of [
      { ...base, kind: 'projects' },
      { ...base, kind: undefined },
      { ...base, version: 2 },
    ]) {
      await expect(tasksService.list(1, 7, 20, undefined, encode(payload))).rejects.toMatchObject({ statusCode: 400 })
    }
    expect(list).not.toHaveBeenCalled()
  })

  test('親Projectが指定組織内に存在しなければ404を返し、タスクを取得しない', async () => {
    projectExists.mockResolvedValue(false)

    await expect(tasksService.list(1, 7, 20)).rejects.toMatchObject({ statusCode: 404 })
    expect(projectExists).toHaveBeenCalledWith(1, 7)
    expect(list).not.toHaveBeenCalled()
  })
})

describe('tasksService.getById', () => {
  beforeEach(() => {
    getById.mockReset()
  })

  test('組織・プロジェクト・タスクIDで取得したタスクをDTOで返す', async () => {
    getById.mockResolvedValue(makeTask(9, { description: '', status: 'DONE' }))

    const result = await tasksService.getById(1, 7, 9)

    expect(getById).toHaveBeenCalledWith(1, 7, 9)
    expect(result).toMatchObject({ id: 9, description: '', status: 'DONE', createdAt: '2026-01-01T00:00:00.000Z' })
    expect(itemDto.safeParse(result).success).toBe(true)
  })

  test('存在しなければ404を返す', async () => {
    getById.mockResolvedValue(null)

    await expect(tasksService.getById(1, 7, 9)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('tasksService の書き込み', () => {
  beforeEach(() => {
    create.mockReset()
    update.mockReset()
    remove.mockReset()
  })

  const succeeded = (value: unknown): { status: string; value: unknown } => ({ status: 'SUCCEEDED', value })

  describe('create', () => {
    test('省略されたdescriptionはnull、statusはTODOとして保存し、作成結果を返す', async () => {
      create.mockResolvedValue(succeeded(makeTask(9)))

      const result = await tasksService.create(1, 7, 3, { title: 'Task 9' })

      expect(create.mock.calls[0]?.[0]).toEqual({
        organizationId: 1,
        projectId: 7,
        actorUserId: 3,
        title: 'Task 9',
        description: null,
        status: 'TODO',
      })
      expect(result).toMatchObject({ id: 9, status: 'TODO', description: null })
    })

    test('指定されたdescription（空文字を含む）とstatusをそのまま保存する', async () => {
      create.mockResolvedValue(succeeded(makeTask(9)))

      await tasksService.create(1, 7, 3, { title: 'T', description: '', status: 'IN_PROGRESS' })

      expect(create.mock.calls[0]?.[0]).toMatchObject({ description: '', status: 'IN_PROGRESS' })
    })

    test.each<Role>(['OWNER', 'ADMIN', 'MEMBER'])('認可コールバックは%sを許可する', async (role) => {
      create.mockResolvedValue(succeeded(makeTask(9)))
      await tasksService.create(1, 7, 3, { title: 'T' })

      expect(runAuthorize(create, role)).toBeNull()
    })

    test('認可コールバックは未知のロールを403で拒否する', async () => {
      create.mockResolvedValue(succeeded(makeTask(9)))
      await tasksService.create(1, 7, 3, { title: 'T' })

      expect(runAuthorize(create, 'GUEST' as Role)).toMatchObject({ statusCode: 403 })
    })
  })

  describe('update', () => {
    test('指定された項目だけをrepositoryへ渡す', async () => {
      update.mockResolvedValue(succeeded(makeTask(9, { status: 'DONE' })))

      const result = await tasksService.update(1, 7, 9, 3, { status: 'DONE' })

      expect(update.mock.calls[0]?.[0]).toEqual({ organizationId: 1, projectId: 7, taskId: 9, actorUserId: 3, data: { status: 'DONE' } })
      expect(result.status).toBe('DONE')
    })

    test('description: nullは説明の削除として渡す', async () => {
      update.mockResolvedValue(succeeded(makeTask(9)))

      await tasksService.update(1, 7, 9, 3, { description: null })

      expect(update.mock.calls[0]?.[0].data).toEqual({ description: null })
    })

    test('3状態を往復できる（DONEからTODOへ戻す更新も拒否しない）', async () => {
      for (const status of ['IN_PROGRESS', 'DONE', 'TODO'] as const) {
        update.mockResolvedValue(succeeded(makeTask(9, { status })))
        expect((await tasksService.update(1, 7, 9, 3, { status })).status).toBe(status)
      }
    })

    test.each<Role>(['OWNER', 'ADMIN', 'MEMBER'])('認可コールバックは%sを許可する', async (role) => {
      update.mockResolvedValue(succeeded(makeTask(9)))
      await tasksService.update(1, 7, 9, 3, { title: 'T' })

      expect(runAuthorize(update, role)).toBeNull()
    })
  })

  describe('remove', () => {
    test('成功時は何も返さない', async () => {
      remove.mockResolvedValue(succeeded(null))

      await expect(tasksService.remove(1, 7, 9, 3)).resolves.toBeUndefined()
      expect(remove.mock.calls[0]?.[0]).toEqual({ organizationId: 1, projectId: 7, taskId: 9, actorUserId: 3 })
    })

    test.each<[Role, number | null]>([
      ['OWNER', null],
      ['ADMIN', null],
      ['MEMBER', 403],
      ['GUEST' as Role, 403],
    ])('認可コールバックは%sに対して %s を返す', async (role, status) => {
      remove.mockResolvedValue(succeeded(null))
      await tasksService.remove(1, 7, 9, 3)

      const rejection = runAuthorize(remove, role)
      if (status === null) expect(rejection).toBeNull()
      else expect(rejection).toMatchObject({ statusCode: status })
    })
  })

  describe('repositoryの失敗結果の変換', () => {
    const calls: [string, () => Promise<unknown>, ReturnType<typeof mock>][] = [
      ['create', () => tasksService.create(1, 7, 3, { title: 'T' }), create],
      ['update', () => tasksService.update(1, 7, 9, 3, { title: 'T' }), update],
      ['remove', () => tasksService.remove(1, 7, 9, 3), remove],
    ]

    test.each(calls)('%s: 組織・所属なし／親Project／Taskなしは404に変換する', async (_name, run, repositoryMock) => {
      for (const status of ['ORGANIZATION_NOT_FOUND', 'PROJECT_NOT_FOUND', 'TASK_NOT_FOUND']) {
        repositoryMock.mockResolvedValue({ status })
        await expect(run()).rejects.toMatchObject({ statusCode: 404 })
      }
    })

    test.each(calls)('%s: 認可拒否の値をそのままthrowする', async (_name, run, repositoryMock) => {
      const error = new AppError(403, '拒否')
      repositoryMock.mockResolvedValue({ status: 'REJECTED', rejection: error })

      await expect(run()).rejects.toBe(error)
    })

    test.each(calls)('%s: 未知のrepository結果・拒否値がAppErrorでない結果は成功にせず通常のErrorで失敗する', async (_name, run, repositoryMock) => {
      for (const result of [{ status: 'UNKNOWN' }, { status: 'REJECTED', rejection: 'forbidden' }, {}]) {
        repositoryMock.mockResolvedValue(result)
        const error = await run().catch((e: unknown) => e)
        expect(error).toBeInstanceOf(Error)
        expect(error).not.toHaveProperty('statusCode')
      }
    })
  })
})
