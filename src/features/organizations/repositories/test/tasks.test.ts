import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { Prisma } from '@/generated/prisma/client'
import type { Role } from '@/shared/membership/entities'

import type { Task } from '../../entities/tasks'

const queryRaw = mock()
const pageQueryRaw = mock()
const transaction = mock()
const taskCreate = mock()
const taskUpdate = mock()
const taskDeleteMany = mock()
const taskFindFirst = mock()
const projectFindFirst = mock()

await mock.module('@/libs/prisma', () => ({
  prisma: { $transaction: transaction, $queryRaw: pageQueryRaw, task: { findFirst: taskFindFirst }, project: { findFirst: projectFindFirst } },
}))

const { tasksRepository, taskWriteResults } = await import('../tasks')

const task: Task = {
  id: 9,
  projectId: 7,
  title: 'Write docs',
  description: null,
  status: 'TODO',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
}

/** tx.$queryRaw のタグ付きテンプレート呼び出しからSQL文字列とバインド値を取り出す。 */
const queryOf = (callIndex: number): { sql: string; values: unknown[] } => {
  const [strings, ...values] = queryRaw.mock.calls[callIndex] as [string[], ...unknown[]]
  return { sql: strings.join('?').replace(/\s+/g, ' ').trim(), values }
}

/**
 * ロック結果を順番に設定する。組織・操作者Membershipの後、projectExists が true なら親Projectのロック結果も設定する。
 * 組織がなければMembershipは問い合わせないため結果も設定しない。
 */
const prepareLocks = (role: Role | null, options: { organizationExists?: boolean; projectExists?: boolean | null } = {}): void => {
  const { organizationExists = true, projectExists = true } = options
  queryRaw.mockResolvedValueOnce(organizationExists ? [{ id: 1 }] : [])
  if (!organizationExists) return
  queryRaw.mockResolvedValueOnce(role === null ? [] : [{ role }])
  // projectExistsがnullなら、認可拒否などで親Projectを問い合わせない前提として結果を設定しない
  if (role === null || projectExists === null) return
  queryRaw.mockResolvedValueOnce(projectExists ? [{ id: 7 }] : [])
}

const allow = (): null => null

describe('tasksRepository.projectExists', () => {
  beforeEach(() => {
    projectFindFirst.mockReset()
  })

  test('組織IDとプロジェクトIDの両方を条件にし、存在すればtrueを返す', async () => {
    projectFindFirst.mockResolvedValue({ id: 7 })

    expect(await tasksRepository.projectExists(1, 7)).toBe(true)
    expect(projectFindFirst).toHaveBeenCalledWith({ where: { id: 7, organizationId: 1 }, select: { id: true } })
  })

  test('存在しない（別組織のIDを含む）場合はfalseを返す', async () => {
    projectFindFirst.mockResolvedValue(null)

    expect(await tasksRepository.projectExists(1, 7)).toBe(false)
  })
})

describe('tasksRepository.list', () => {
  const createdAt = new Date('2026-01-01T00:00:00.000Z')

  beforeEach(() => {
    pageQueryRaw.mockReset()
    transaction.mockReset()
  })

  /** $queryRaw に渡された Prisma.Sql を取り出す。 */
  const getIssuedSql = (): Prisma.Sql => pageQueryRaw.mock.calls[0]?.[0] as Prisma.Sql

  test('状態・境界値なしは組織ID・プロジェクトID・takeだけをバインドし、組織条件をJOINで含めて新しい順で取得する', async () => {
    pageQueryRaw.mockResolvedValue([])

    await tasksRepository.list(1, 7, null, 21, null)

    const sql = getIssuedSql()
    expect(sql.values).toEqual([7, 1, 21])
    expect(sql.sql).toContain('JOIN "Project" p ON p.id = t."projectId"')
    expect(sql.sql).toContain('t."projectId" = ')
    expect(sql.sql).toContain('p."organizationId" = ')
    expect(sql.sql).not.toContain('<')
    expect(sql.sql).not.toContain('"TaskStatus"')
    expect(sql.sql).toContain('ORDER BY t."createdAt" DESC, t.id DESC')
  })

  test('状態指定は同じSQLのWHEREで絞り込む', async () => {
    pageQueryRaw.mockResolvedValue([])

    await tasksRepository.list(1, 7, 'DONE', 21, null)

    const sql = getIssuedSql()
    expect(sql.values).toEqual([7, 1, 'DONE', 21])
    expect(sql.sql).toContain('t."status" = ')
    expect(sql.sql).toContain('::"TaskStatus"')
  })

  test('境界値がある場合は行値比較で絞り込み、状態・境界値・takeの順でバインドする', async () => {
    pageQueryRaw.mockResolvedValue([])

    await tasksRepository.list(1, 7, 'TODO', 21, { createdAt, id: 5 })

    const sql = getIssuedSql()
    expect(sql.values).toEqual([7, 1, 'TODO', createdAt, 5, 21])
    expect(sql.sql).toContain('(t."createdAt", t.id) < (')
  })

  test('取得した行をTaskエンティティへ変換する（余分な列は含めない）', async () => {
    pageQueryRaw.mockResolvedValue([{ ...task, extra: 'x' }])

    expect(await tasksRepository.list(1, 7, null, 21, null)).toEqual([task])
  })

  test('行ロックのためのtransactionを使わず、予期しないDBエラーはそのままthrowする', async () => {
    pageQueryRaw.mockRejectedValue(new Error('接続エラー'))

    await expect(tasksRepository.list(1, 7, null, 21, null)).rejects.toThrow('接続エラー')
    expect(transaction).not.toHaveBeenCalled()
  })
})

describe('tasksRepository.getById', () => {
  beforeEach(() => {
    taskFindFirst.mockReset()
    transaction.mockReset()
  })

  test('タスクID・プロジェクトID・親Projectの組織IDを条件にして取得する', async () => {
    taskFindFirst.mockResolvedValue(task)

    expect(await tasksRepository.getById(1, 7, 9)).toEqual(task)
    expect(taskFindFirst).toHaveBeenCalledWith({ where: { id: 9, projectId: 7, project: { organizationId: 1 } } })
    expect(transaction).not.toHaveBeenCalled()
  })

  test('存在しない（別組織・別Projectを含む）場合はnullを返す', async () => {
    taskFindFirst.mockResolvedValue(null)

    expect(await tasksRepository.getById(1, 7, 9)).toBeNull()
  })
})

describe('tasksRepository の書き込み', () => {
  beforeEach(() => {
    queryRaw.mockReset()
    taskCreate.mockReset()
    taskUpdate.mockReset()
    taskDeleteMany.mockReset()
    transaction.mockReset()
    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        $queryRaw: queryRaw,
        task: { create: taskCreate, update: taskUpdate, deleteMany: taskDeleteMany },
      }),
    )
  })

  describe('トランザクションの分離レベル', () => {
    const writes: [string, () => Promise<unknown>][] = [
      ['create', () => tasksRepository.create({ organizationId: 1, projectId: 7, actorUserId: 3, title: 'T', description: null, status: 'TODO' }, () => null)],
      ['update', () => tasksRepository.update({ organizationId: 1, projectId: 7, taskId: 9, actorUserId: 3, data: { title: 'T' } }, () => null)],
      ['remove', () => tasksRepository.remove({ organizationId: 1, projectId: 7, taskId: 9, actorUserId: 3 }, () => null)],
    ]

    test.each(writes)('%s は READ COMMITTED を明示してtransactionを開始する', async (_name, run) => {
      // 組織が存在しない結果で早期に終了させ、transactionの呼び出し引数だけを確認する
      queryRaw.mockResolvedValueOnce([])

      await run()

      expect(transaction).toHaveBeenCalledTimes(1)
      expect(transaction.mock.calls[0]?.[1]).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })
    })
  })

  describe('共通のロック順序', () => {
    const input = { organizationId: 1, projectId: 7, taskId: 9, actorUserId: 3, data: { title: 'Beta' } }

    test('Organization(FOR KEY SHARE) → Membership(FOR SHARE) → Project(FOR KEY SHARE) → Task(FOR UPDATE)の順でロックする', async () => {
      prepareLocks('ADMIN')
      queryRaw.mockResolvedValueOnce([{ id: 9 }])
      taskUpdate.mockResolvedValue({ ...task, title: 'Beta' })
      const authorize = mock(allow)

      await tasksRepository.update(input, authorize)

      expect(queryRaw).toHaveBeenCalledTimes(4)
      expect(queryOf(0).sql).toContain('FROM "Organization"')
      expect(queryOf(0).sql).toContain('FOR KEY SHARE')
      expect(queryOf(0).values).toEqual([1])
      expect(queryOf(1).sql).toContain('FROM "Membership"')
      expect(queryOf(1).sql).toContain('FOR SHARE')
      expect(queryOf(1).sql).not.toContain('FOR KEY SHARE')
      expect(queryOf(1).values).toEqual([1, 3])
      expect(queryOf(2).sql).toContain('FROM "Project"')
      expect(queryOf(2).sql).toContain('"organizationId" =')
      expect(queryOf(2).sql).toContain('FOR KEY SHARE')
      expect(queryOf(2).values).toEqual([7, 1])
      expect(queryOf(3).sql).toContain('FROM "Task"')
      expect(queryOf(3).sql).toContain('"projectId" =')
      expect(queryOf(3).sql).toContain('FOR UPDATE')
      expect(queryOf(3).values).toEqual([9, 7])
      // 認可コールバックはロック後の最新ロールを受け取る
      expect(authorize).toHaveBeenCalledWith({ operatorRole: 'ADMIN' })
      // どのロックもJOINやUser行のロックを含まない
      for (let i = 0; i < 4; i++) {
        expect(queryOf(i).sql).not.toContain('JOIN')
        expect(queryOf(i).sql).not.toContain('"User"')
      }
    })

    test('認可コールバックは親Projectのロックより前に呼ばれる（拒否時は親・Taskをロックしない）', async () => {
      prepareLocks('MEMBER')

      const result = await tasksRepository.remove({ organizationId: 1, projectId: 7, taskId: 9, actorUserId: 3 }, () => 'forbidden')

      expect(result).toEqual({ status: taskWriteResults.rejected, rejection: 'forbidden' })
      expect(queryRaw).toHaveBeenCalledTimes(2)
      expect(taskDeleteMany).not.toHaveBeenCalled()
    })
  })

  describe('create', () => {
    const input = { organizationId: 1, projectId: 7, actorUserId: 3, title: 'Write docs', description: null, status: 'TODO' as const }

    test.each<Role>(['OWNER', 'ADMIN', 'MEMBER'])('Organization・Membership・Projectをロックし、%sが作成できる', async (role) => {
      prepareLocks(role)
      taskCreate.mockResolvedValue(task)
      const authorize = mock(allow)

      const result = await tasksRepository.create(input, authorize)

      expect(result).toEqual({ status: taskWriteResults.succeeded, value: task })
      expect(queryRaw).toHaveBeenCalledTimes(3)
      expect(authorize).toHaveBeenCalledWith({ operatorRole: role })
      expect(taskCreate).toHaveBeenCalledWith({ data: { projectId: 7, title: 'Write docs', description: null, status: 'TODO' } })
    })

    test('組織なしはorganizationNotFound、ロック後に所属が消えていてもorganizationNotFoundで、作成しない', async () => {
      prepareLocks(null, { organizationExists: false })
      expect(await tasksRepository.create(input, allow)).toEqual({ status: taskWriteResults.organizationNotFound })
      expect(queryRaw).toHaveBeenCalledTimes(1)

      prepareLocks(null)
      expect(await tasksRepository.create(input, allow)).toEqual({ status: taskWriteResults.organizationNotFound })
      expect(taskCreate).not.toHaveBeenCalled()
    })

    test('認可拒否は拒否値を返し、親Projectがなければprojectを確認した結果のprojectNotFoundを返して、作成しない', async () => {
      prepareLocks('MEMBER', { projectExists: null })
      expect(await tasksRepository.create(input, () => 'forbidden')).toEqual({ status: taskWriteResults.rejected, rejection: 'forbidden' })

      prepareLocks('OWNER', { projectExists: false })
      expect(await tasksRepository.create(input, allow)).toEqual({ status: taskWriteResults.projectNotFound })
      expect(taskCreate).not.toHaveBeenCalled()
    })

    test('作成に失敗した場合はそのままthrowする（transactionがrollbackされる）', async () => {
      prepareLocks('OWNER')
      taskCreate.mockRejectedValue(new Error('INSERT失敗'))

      await expect(tasksRepository.create(input, allow)).rejects.toThrow('INSERT失敗')
    })
  })

  describe('update', () => {
    const base = { organizationId: 1, projectId: 7, taskId: 9, actorUserId: 3 }

    test('指定された項目だけを更新し、条件にプロジェクトIDを含める', async () => {
      prepareLocks('OWNER')
      queryRaw.mockResolvedValueOnce([{ id: 9 }])
      taskUpdate.mockResolvedValue({ ...task, status: 'DONE' })

      const result = await tasksRepository.update({ ...base, data: { status: 'DONE' } }, allow)

      expect(result).toEqual({ status: taskWriteResults.succeeded, value: { ...task, status: 'DONE' } })
      expect(taskUpdate).toHaveBeenCalledWith({ where: { id: 9, projectId: 7 }, data: { status: 'DONE' } })
    })

    test('description: nullとtitle・descriptionの同時指定をそのまま更新へ渡す', async () => {
      prepareLocks('OWNER')
      queryRaw.mockResolvedValueOnce([{ id: 9 }])
      taskUpdate.mockResolvedValue(task)

      await tasksRepository.update({ ...base, data: { title: 'T', description: null } }, allow)

      expect(taskUpdate).toHaveBeenCalledWith({ where: { id: 9, projectId: 7 }, data: { title: 'T', description: null } })
    })

    test('対象TaskがなければtaskNotFoundを返し、更新しない', async () => {
      prepareLocks('OWNER')
      queryRaw.mockResolvedValueOnce([])

      expect(await tasksRepository.update({ ...base, data: { title: 'T' } }, allow)).toEqual({ status: taskWriteResults.taskNotFound })
      expect(taskUpdate).not.toHaveBeenCalled()
    })

    test('親Projectがなければprojectを確認した結果のprojectNotFoundを返し、Taskをロックしない', async () => {
      prepareLocks('OWNER', { projectExists: false })

      expect(await tasksRepository.update({ ...base, data: { title: 'T' } }, allow)).toEqual({ status: taskWriteResults.projectNotFound })
      expect(queryRaw).toHaveBeenCalledTimes(3)
    })

    test('更新に失敗した場合はそのままthrowする', async () => {
      prepareLocks('OWNER')
      queryRaw.mockResolvedValueOnce([{ id: 9 }])
      taskUpdate.mockRejectedValue(new Error('UPDATE失敗'))

      await expect(tasksRepository.update({ ...base, data: { title: 'T' } }, allow)).rejects.toThrow('UPDATE失敗')
    })
  })

  describe('remove', () => {
    const input = { organizationId: 1, projectId: 7, taskId: 9, actorUserId: 3 }

    test('Taskをロックしたうえで、プロジェクトIDとタスクIDの条件で削除する', async () => {
      prepareLocks('ADMIN')
      queryRaw.mockResolvedValueOnce([{ id: 9 }])
      taskDeleteMany.mockResolvedValue({ count: 1 })

      const result = await tasksRepository.remove(input, allow)

      expect(result).toEqual({ status: taskWriteResults.succeeded, value: null })
      expect(taskDeleteMany).toHaveBeenCalledWith({ where: { id: 9, projectId: 7 } })
    })

    test('ロック後にMEMBERへ降格していれば拒否値を返し、削除しない', async () => {
      prepareLocks('MEMBER')

      expect(await tasksRepository.remove(input, () => 'forbidden')).toEqual({ status: taskWriteResults.rejected, rejection: 'forbidden' })
      expect(taskDeleteMany).not.toHaveBeenCalled()
    })

    test('対象Taskがない、または削除件数が1でなければtaskNotFoundを返す', async () => {
      prepareLocks('OWNER')
      queryRaw.mockResolvedValueOnce([])
      expect(await tasksRepository.remove(input, allow)).toEqual({ status: taskWriteResults.taskNotFound })

      prepareLocks('OWNER')
      queryRaw.mockResolvedValueOnce([{ id: 9 }])
      taskDeleteMany.mockResolvedValue({ count: 0 })
      expect(await tasksRepository.remove(input, allow)).toEqual({ status: taskWriteResults.taskNotFound })
    })

    test('組織・所属・親Projectがなければそれぞれの結果を返す', async () => {
      prepareLocks(null, { organizationExists: false })
      expect(await tasksRepository.remove(input, allow)).toEqual({ status: taskWriteResults.organizationNotFound })

      prepareLocks(null)
      expect(await tasksRepository.remove(input, allow)).toEqual({ status: taskWriteResults.organizationNotFound })

      prepareLocks('OWNER', { projectExists: false })
      expect(await tasksRepository.remove(input, allow)).toEqual({ status: taskWriteResults.projectNotFound })
      expect(taskDeleteMany).not.toHaveBeenCalled()
    })
  })
})
