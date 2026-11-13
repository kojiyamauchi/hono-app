import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { Prisma } from '@/generated/prisma/client'
import type { Role } from '@/shared/membership/entities'

import type { Project } from '../entities/projects'

const queryRaw = mock()
const pageQueryRaw = mock()
const transaction = mock()
const projectCreate = mock()
const projectUpdate = mock()
const projectDeleteMany = mock()
const projectFindFirst = mock()
const auditLogCreate = mock()

await mock.module('@/libs/prisma', () => ({
  prisma: { $transaction: transaction, $queryRaw: pageQueryRaw, project: { findFirst: projectFindFirst } },
}))

const { projectRepository, projectWriteResults } = await import('./projects')

const project: Project = {
  id: 7,
  organizationId: 1,
  name: 'Alpha',
  description: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
}

/** $queryRaw のタグ付きテンプレート呼び出しからSQL文字列とバインド値を取り出す。 */
const queryOf = (callIndex: number): { sql: string; values: unknown[] } => {
  const [strings, ...values] = queryRaw.mock.calls[callIndex] as [string[], ...unknown[]]
  return { sql: strings.join('?').replace(/\s+/g, ' ').trim(), values }
}

/** 組織・操作者Membershipのロック結果を順番に設定する。 */
const prepareLocks = (role: Role | null, organizationExists = true): void => {
  queryRaw.mockResolvedValueOnce(organizationExists ? [{ id: 1 }] : [])
  if (organizationExists) {
    queryRaw.mockResolvedValueOnce(role === null ? [] : [{ id: 5, role }])
  }
}

const allow = (): null => null

describe('projectRepository.findPageByOrganization', () => {
  const createdAt = new Date('2026-01-01T00:00:00.000Z')

  beforeEach(() => {
    pageQueryRaw.mockReset()
  })

  /** $queryRaw に渡された Prisma.Sql を取り出す。 */
  const getIssuedSql = (): Prisma.Sql => pageQueryRaw.mock.calls[0]?.[0] as Prisma.Sql

  test('境界値がない場合は組織IDとtakeだけをバインドし、境界条件を含めず新しい順で取得する', async () => {
    pageQueryRaw.mockResolvedValue([])

    await projectRepository.findPageByOrganization(2, 21, null)

    const sql = getIssuedSql()
    expect(sql.values).toEqual([2, 21])
    expect(sql.sql).not.toContain('<')
    expect(sql.sql).toContain('ORDER BY "createdAt" DESC, id DESC')
  })

  test('境界値がある場合は行値比較で絞り込み、組織ID・境界値・takeをこの順でバインドする', async () => {
    pageQueryRaw.mockResolvedValue([])

    await projectRepository.findPageByOrganization(2, 21, { createdAt, id: 5 })

    const sql = getIssuedSql()
    expect(sql.values).toEqual([2, createdAt, 5, 21])
    expect(sql.sql).toContain('("createdAt", id) < (')
    expect(sql.sql).toContain('"organizationId" = ')
  })

  test('取得した行をProjectエンティティへ変換する（余分な列は含めない）', async () => {
    pageQueryRaw.mockResolvedValue([{ ...project, extra: 'x' }])

    const result = await projectRepository.findPageByOrganization(2, 21, null)

    expect(result).toEqual([project])
  })

  test('予期しないDBエラーはそのままthrowする', async () => {
    pageQueryRaw.mockRejectedValue(new Error('接続エラー'))

    await expect(projectRepository.findPageByOrganization(2, 21, null)).rejects.toThrow('接続エラー')
  })
})

describe('projectRepository.findByOrganizationAndId', () => {
  beforeEach(() => {
    projectFindFirst.mockReset()
  })

  test('組織IDとプロジェクトIDの両方を条件にして取得する', async () => {
    projectFindFirst.mockResolvedValue(project)

    expect(await projectRepository.findByOrganizationAndId(1, 7)).toEqual(project)
    expect(projectFindFirst).toHaveBeenCalledWith({ where: { id: 7, organizationId: 1 } })
  })

  test('存在しない（別組織のIDを含む）場合はnullを返す', async () => {
    projectFindFirst.mockResolvedValue(null)

    expect(await projectRepository.findByOrganizationAndId(1, 7)).toBeNull()
  })
})

describe('projectRepository の書き込み', () => {
  beforeEach(() => {
    queryRaw.mockReset()
    projectCreate.mockReset()
    projectUpdate.mockReset()
    projectDeleteMany.mockReset()
    auditLogCreate.mockReset()
    transaction.mockReset()
    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        $queryRaw: queryRaw,
        project: { create: projectCreate, update: projectUpdate, deleteMany: projectDeleteMany },
        auditLog: { create: auditLogCreate },
      }),
    )
  })

  describe('createWithAuthorization', () => {
    const input = { organizationId: 1, actorUserId: 3, name: 'Alpha', description: null }

    test.each<Role>(['OWNER', 'ADMIN'])('Organization(FOR NO KEY UPDATE)、Membership(FOR UPDATE)の順でロックし、%sが作成できる', async (role) => {
      prepareLocks(role)
      projectCreate.mockResolvedValue(project)
      const authorize = mock(allow)

      const result = await projectRepository.createWithAuthorization(input, authorize)

      expect(result).toEqual({ status: projectWriteResults.succeeded, value: project })
      expect(queryOf(0).sql).toContain('FROM "Organization"')
      expect(queryOf(0).sql).toContain('FOR NO KEY UPDATE')
      expect(queryOf(0).values).toEqual([1])
      expect(queryOf(1).sql).toContain('FROM "Membership"')
      expect(queryOf(1).sql).toContain('FOR UPDATE')
      expect(queryOf(1).values).toEqual([1, 3])
      // 認可コールバックはロック後の最新ロールを受け取る
      expect(authorize).toHaveBeenCalledWith({ operatorRole: role })
      expect(projectCreate).toHaveBeenCalledWith({ data: { organizationId: 1, name: 'Alpha', description: null } })
    })

    test('作成と同じtransaction内で、実際に保存された値をafterとするPROJECT_CREATEDを1件記録する（beforeは持たない）', async () => {
      prepareLocks('OWNER')
      // 保存結果（DBが返した値）が入力と異なっても、保存結果を記録する
      projectCreate.mockResolvedValue({ ...project, name: 'Saved', description: '' })

      await projectRepository.createWithAuthorization(input, allow)

      expect(transaction).toHaveBeenCalledTimes(1)
      expect(auditLogCreate).toHaveBeenCalledTimes(1)
      expect(auditLogCreate).toHaveBeenCalledWith({
        data: { organizationId: 1, action: 'PROJECT_CREATED', actorUserId: 3, projectId: 7, projectAfter: { name: 'Saved', description: '' } },
      })
      expect(auditLogCreate.mock.calls[0]?.[0].data).not.toHaveProperty('projectBefore')
    })

    test('組織なし・所属なし・認可拒否では作成も記録もしない', async () => {
      prepareLocks(null, false)
      await projectRepository.createWithAuthorization(input, allow)
      prepareLocks(null)
      await projectRepository.createWithAuthorization(input, allow)
      prepareLocks('MEMBER')
      await projectRepository.createWithAuthorization(input, () => 'forbidden')

      expect(projectCreate).not.toHaveBeenCalled()
      expect(auditLogCreate).not.toHaveBeenCalled()
    })

    test('監査ログのINSERTに失敗した場合はそのままthrowする（作成もrollbackされる）', async () => {
      prepareLocks('OWNER')
      projectCreate.mockResolvedValue(project)
      auditLogCreate.mockRejectedValue(new Error('ログINSERT失敗'))

      await expect(projectRepository.createWithAuthorization(input, allow)).rejects.toThrow('ログINSERT失敗')
    })

    test('組織が存在しなければorganizationNotFoundを返し、作成しない', async () => {
      prepareLocks(null, false)

      expect(await projectRepository.createWithAuthorization(input, allow)).toEqual({ status: projectWriteResults.organizationNotFound })
      expect(queryRaw).toHaveBeenCalledTimes(1)
      expect(projectCreate).not.toHaveBeenCalled()
    })

    test('ロック後に所属が消えていればorganizationNotFoundを返し、作成しない', async () => {
      prepareLocks(null)

      expect(await projectRepository.createWithAuthorization(input, allow)).toEqual({ status: projectWriteResults.organizationNotFound })
      expect(projectCreate).not.toHaveBeenCalled()
    })

    test('認可コールバックが拒否した場合は拒否値をそのまま返し、作成しない', async () => {
      prepareLocks('MEMBER')

      const result = await projectRepository.createWithAuthorization(input, () => 'forbidden')

      expect(result).toEqual({ status: projectWriteResults.rejected, rejection: 'forbidden' })
      expect(projectCreate).not.toHaveBeenCalled()
    })

    test('作成に失敗した場合はそのままthrowする（transactionがrollbackされる）', async () => {
      prepareLocks('OWNER')
      projectCreate.mockRejectedValue(new Error('INSERT失敗'))

      await expect(projectRepository.createWithAuthorization(input, allow)).rejects.toThrow('INSERT失敗')
    })
  })

  describe('updateWithAuthorization', () => {
    const input = { organizationId: 1, projectId: 7, actorUserId: 3, data: { name: 'Beta' } }
    const lockedProject = { id: 7, name: 'Alpha', description: null }
    const record = (): boolean => true
    const skip = (): boolean => false

    test('Organization → Membership → Projectの順でロックし、Projectは組織IDとIDで絞ってFOR UPDATEする', async () => {
      prepareLocks('ADMIN')
      queryRaw.mockResolvedValueOnce([lockedProject])
      projectUpdate.mockResolvedValue({ ...project, name: 'Beta' })
      const authorize = mock(allow)

      const result = await projectRepository.updateWithAuthorization(input, authorize, record)

      expect(result).toEqual({ status: projectWriteResults.succeeded, value: { ...project, name: 'Beta' } })
      expect(queryOf(0).sql).toContain('FROM "Organization"')
      expect(queryOf(1).sql).toContain('FROM "Membership"')
      expect(queryOf(2).sql).toContain('FROM "Project"')
      expect(queryOf(2).sql).toContain('"organizationId" =')
      expect(queryOf(2).sql).toContain('FOR UPDATE')
      expect(queryOf(2).sql).toContain('SELECT id, name, description')
      expect(queryOf(2).values).toEqual([7, 1])
      expect(authorize).toHaveBeenCalledWith({ operatorRole: 'ADMIN' })
      // 最終UPDATEの条件にも組織IDとプロジェクトIDの両方を含める（whereの完全一致）
      expect(projectUpdate).toHaveBeenCalledWith({ where: { id: 7, organizationId: 1 }, data: { name: 'Beta' } })
    })

    test('指定された項目だけを更新する', async () => {
      prepareLocks('OWNER')
      queryRaw.mockResolvedValueOnce([lockedProject])
      projectUpdate.mockResolvedValue(project)

      await projectRepository.updateWithAuthorization({ ...input, data: { description: null } }, allow, skip)
      expect(projectUpdate).toHaveBeenLastCalledWith({ where: { id: 7, organizationId: 1 }, data: { description: null } })

      prepareLocks('OWNER')
      queryRaw.mockResolvedValueOnce([lockedProject])
      await projectRepository.updateWithAuthorization({ ...input, data: { name: 'B', description: '' } }, allow, skip)
      expect(projectUpdate).toHaveBeenLastCalledWith({ where: { id: 7, organizationId: 1 }, data: { name: 'B', description: '' } })
    })

    test('MEMBERは対象Projectをロックする前に拒否される', async () => {
      prepareLocks('MEMBER')

      const result = await projectRepository.updateWithAuthorization(input, () => 'forbidden', record)

      expect(result).toEqual({ status: projectWriteResults.rejected, rejection: 'forbidden' })
      expect(queryRaw).toHaveBeenCalledTimes(2)
      expect(projectUpdate).not.toHaveBeenCalled()
      expect(auditLogCreate).not.toHaveBeenCalled()
    })

    test('組織または所属がなければorganizationNotFound、ProjectがなければprojectNotFoundを返し更新も記録もしない', async () => {
      prepareLocks(null)
      expect(await projectRepository.updateWithAuthorization(input, allow, record)).toEqual({ status: projectWriteResults.organizationNotFound })

      prepareLocks('OWNER')
      queryRaw.mockResolvedValueOnce([])
      expect(await projectRepository.updateWithAuthorization(input, allow, record)).toEqual({ status: projectWriteResults.projectNotFound })
      expect(projectUpdate).not.toHaveBeenCalled()
      expect(auditLogCreate).not.toHaveBeenCalled()
    })

    test('判定コールバックにはロック後のDB値（before）と保存後の値（after）を渡し、trueなら同じtransactionで両方を記録する', async () => {
      prepareLocks('OWNER')
      // ロック後のDB値は、リクエスト前に読んだ値とは無関係にこの値がbeforeになる
      queryRaw.mockResolvedValueOnce([{ id: 7, name: 'Locked', description: 'old' }])
      projectUpdate.mockResolvedValue({ ...project, name: 'Saved', description: null })
      const shouldRecord = mock(record)

      await projectRepository.updateWithAuthorization(input, allow, shouldRecord)

      expect(shouldRecord).toHaveBeenCalledWith({ before: { name: 'Locked', description: 'old' }, after: { name: 'Saved', description: null } })
      expect(transaction).toHaveBeenCalledTimes(1)
      expect(auditLogCreate).toHaveBeenCalledTimes(1)
      expect(auditLogCreate).toHaveBeenCalledWith({
        data: {
          organizationId: 1,
          action: 'PROJECT_UPDATED',
          actorUserId: 3,
          projectId: 7,
          projectBefore: { name: 'Locked', description: 'old' },
          projectAfter: { name: 'Saved', description: null },
        },
      })
    })

    test('判定コールバックがfalse（実変更なし）なら更新は確定しログは作らない', async () => {
      prepareLocks('OWNER')
      queryRaw.mockResolvedValueOnce([lockedProject])
      projectUpdate.mockResolvedValue(project)

      const result = await projectRepository.updateWithAuthorization(input, allow, skip)

      expect(result).toEqual({ status: projectWriteResults.succeeded, value: project })
      expect(projectUpdate).toHaveBeenCalledTimes(1)
      expect(auditLogCreate).not.toHaveBeenCalled()
    })

    test('監査ログのINSERTに失敗した場合はそのままthrowする（更新もrollbackされる）', async () => {
      prepareLocks('OWNER')
      queryRaw.mockResolvedValueOnce([lockedProject])
      projectUpdate.mockResolvedValue({ ...project, name: 'Beta' })
      auditLogCreate.mockRejectedValue(new Error('ログINSERT失敗'))

      await expect(projectRepository.updateWithAuthorization(input, allow, record)).rejects.toThrow('ログINSERT失敗')
    })
  })

  describe('removeWithAuthorization', () => {
    const input = { organizationId: 1, projectId: 7, actorUserId: 3 }

    test('Organization → Membership → Projectの順でロックし、組織IDとIDで絞って削除する', async () => {
      prepareLocks('OWNER')
      queryRaw.mockResolvedValueOnce([{ id: 7, name: 'Alpha', description: null }])
      projectDeleteMany.mockResolvedValue({ count: 1 })

      const result = await projectRepository.removeWithAuthorization(input, allow)

      expect(result).toEqual({ status: projectWriteResults.succeeded, value: null })
      expect(queryOf(2).sql).toContain('FROM "Project"')
      expect(queryOf(2).values).toEqual([7, 1])
      expect(projectDeleteMany).toHaveBeenCalledWith({ where: { id: 7, organizationId: 1 } })
    })

    test('削除と同じtransaction内で、ロック後のDB値をbeforeとするPROJECT_DELETEDを1件記録する（afterは持たない）', async () => {
      prepareLocks('ADMIN')
      const longDescription = 'd'.repeat(5000)
      queryRaw.mockResolvedValueOnce([{ id: 7, name: 'n'.repeat(300), description: longDescription }])
      projectDeleteMany.mockResolvedValue({ count: 1 })

      await projectRepository.removeWithAuthorization(input, allow)

      expect(transaction).toHaveBeenCalledTimes(1)
      expect(auditLogCreate).toHaveBeenCalledTimes(1)
      // 入力上限を超える既存値も切り詰めずに記録する
      expect(auditLogCreate).toHaveBeenCalledWith({
        data: {
          organizationId: 1,
          action: 'PROJECT_DELETED',
          actorUserId: 3,
          projectId: 7,
          projectBefore: { name: 'n'.repeat(300), description: longDescription },
        },
      })
      expect(auditLogCreate.mock.calls[0]?.[0].data).not.toHaveProperty('projectAfter')
    })

    test('削除0件・Project不存在・認可拒否では記録しない', async () => {
      prepareLocks('OWNER')
      queryRaw.mockResolvedValueOnce([{ id: 7, name: 'Alpha', description: null }])
      projectDeleteMany.mockResolvedValue({ count: 0 })
      await projectRepository.removeWithAuthorization(input, allow)
      prepareLocks('OWNER')
      queryRaw.mockResolvedValueOnce([])
      await projectRepository.removeWithAuthorization(input, allow)
      prepareLocks('MEMBER')
      await projectRepository.removeWithAuthorization(input, () => 'forbidden')

      expect(auditLogCreate).not.toHaveBeenCalled()
    })

    test('監査ログのINSERTに失敗した場合はそのままthrowする（削除もrollbackされる）', async () => {
      prepareLocks('OWNER')
      queryRaw.mockResolvedValueOnce([{ id: 7, name: 'Alpha', description: null }])
      projectDeleteMany.mockResolvedValue({ count: 1 })
      auditLogCreate.mockRejectedValue(new Error('ログINSERT失敗'))

      await expect(projectRepository.removeWithAuthorization(input, allow)).rejects.toThrow('ログINSERT失敗')
    })

    test('MEMBERは対象の有無を確認せずに拒否される', async () => {
      prepareLocks('MEMBER')

      const result = await projectRepository.removeWithAuthorization(input, () => 'forbidden')

      expect(result).toEqual({ status: projectWriteResults.rejected, rejection: 'forbidden' })
      expect(queryRaw).toHaveBeenCalledTimes(2)
      expect(projectDeleteMany).not.toHaveBeenCalled()
    })

    test('Projectが存在しない（別組織のIDを含む）、または削除0件ならprojectNotFoundを返す', async () => {
      prepareLocks('OWNER')
      queryRaw.mockResolvedValueOnce([])
      expect(await projectRepository.removeWithAuthorization(input, allow)).toEqual({ status: projectWriteResults.projectNotFound })

      prepareLocks('OWNER')
      queryRaw.mockResolvedValueOnce([{ id: 7 }])
      projectDeleteMany.mockResolvedValue({ count: 0 })
      expect(await projectRepository.removeWithAuthorization(input, allow)).toEqual({ status: projectWriteResults.projectNotFound })
    })

    test('組織または所属がなければorganizationNotFoundを返す', async () => {
      prepareLocks(null, false)

      expect(await projectRepository.removeWithAuthorization(input, allow)).toEqual({ status: projectWriteResults.organizationNotFound })
    })
  })
})
