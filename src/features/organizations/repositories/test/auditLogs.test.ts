import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { Prisma } from '@/generated/prisma/client'

const queryRaw = mock()

await mock.module('@/libs/prisma', () => ({
  prisma: { $queryRaw: queryRaw },
}))

const { auditLogsRepository } = await import('../auditLogs')

describe('auditLogsRepository.findPage', () => {
  const createdAt = new Date('2026-01-01T00:00:00.000Z')

  beforeEach(() => {
    queryRaw.mockReset()
  })

  /** $queryRaw に渡された Prisma.Sql を取り出す。 */
  const getIssuedSql = (): Prisma.Sql => queryRaw.mock.calls[0]?.[0] as Prisma.Sql

  test('境界値がない場合は組織IDとtakeだけをバインドし、境界条件を含めず新しい順で取得する', async () => {
    queryRaw.mockResolvedValue([])

    await auditLogsRepository.findPage(2, 21, null)

    const sql = getIssuedSql()
    expect(sql.values).toEqual([2, 21])
    expect(sql.sql).not.toContain('<')
    expect(sql.sql).toContain('ORDER BY "createdAt" DESC, id DESC')
  })

  test('境界値がある場合は行値比較で絞り込み、組織ID・境界値・takeをこの順でバインドする', async () => {
    queryRaw.mockResolvedValue([])

    await auditLogsRepository.findPage(2, 21, { createdAt, id: 5 })

    const sql = getIssuedSql()
    expect(sql.values).toEqual([2, createdAt, 5, 21])
    expect(sql.sql).toContain('("createdAt", id) < (')
    expect(sql.sql).toContain('"organizationId" = ')
  })

  test('プロジェクト向け列も取得し、ProjectやUserをJOINしない', async () => {
    queryRaw.mockResolvedValue([])

    await auditLogsRepository.findPage(2, 21, null)

    const sql = getIssuedSql().sql
    expect(sql).toContain('"projectId", "projectBefore", "projectAfter"')
    expect(sql).not.toContain('JOIN')
  })

  /**
   * DBが返す行を再現する。SELECTの補助boolean（`IS NULL` 判定）を、値がnullかどうかから既定で補う。
   * JSON nullのように「値はnullだがSQL NULLではない」行は、行側で補助booleanをfalseに明示して上書きする。
   */
  const withFlags = (row: unknown): unknown => {
    const r = row as Record<string, unknown>
    return { projectBeforeIsSqlNull: r.projectBefore === null, projectAfterIsSqlNull: r.projectAfter === null, ...r }
  }
  const mockRows = (rows: unknown[]): void => {
    queryRaw.mockResolvedValue(rows.map(withFlags))
  }

  const memberRow = {
    id: 1,
    organizationId: 2,
    action: 'MEMBER_ROLE_CHANGED',
    actorUserId: 10,
    targetUserId: 11,
    targetMembershipId: 12,
    previousRole: 'MEMBER',
    newRole: 'ADMIN',
    projectId: null,
    projectBefore: null,
    projectAfter: null,
    createdAt,
  }
  const projectRowBase = {
    id: 5,
    organizationId: 2,
    actorUserId: 10,
    targetUserId: null,
    targetMembershipId: null,
    previousRole: null,
    newRole: null,
    projectId: 42,
    createdAt,
  }

  test('既存3イベントの行をAuditLogエンティティへ変換する（プロジェクト向けキーは含めない）', async () => {
    const removedRow = { ...memberRow, id: 3, action: 'MEMBER_REMOVED', newRole: null }
    mockRows([memberRow, { ...memberRow, id: 2, action: 'OWNERSHIP_TRANSFERRED', newRole: 'OWNER' }, removedRow])

    const result = await auditLogsRepository.findPage(2, 21, null)

    expect(result).toEqual([
      {
        id: 1,
        organizationId: 2,
        action: 'MEMBER_ROLE_CHANGED',
        actorUserId: 10,
        targetUserId: 11,
        targetMembershipId: 12,
        previousRole: 'MEMBER',
        newRole: 'ADMIN',
        createdAt,
      },
      expect.objectContaining({ id: 2, action: 'OWNERSHIP_TRANSFERRED', newRole: 'OWNER' }),
      expect.objectContaining({ id: 3, action: 'MEMBER_REMOVED', newRole: null }),
    ])
    expect(result[0]).not.toHaveProperty('projectId')
  })

  test('プロジェクト3イベントの行をAuditLogエンティティへ変換する（説明のnullと空文字は区別する）', async () => {
    const created = { ...projectRowBase, id: 5, action: 'PROJECT_CREATED', projectBefore: null, projectAfter: { name: 'A', description: null } }
    const updated = {
      ...projectRowBase,
      id: 6,
      action: 'PROJECT_UPDATED',
      projectBefore: { name: 'A', description: null },
      projectAfter: { name: 'A', description: '' },
    }
    const deleted = { ...projectRowBase, id: 7, action: 'PROJECT_DELETED', projectBefore: { name: 'A', description: '' }, projectAfter: null }
    mockRows([deleted, updated, created])

    const result = await auditLogsRepository.findPage(2, 21, null)

    expect(result).toEqual([
      {
        id: 7,
        organizationId: 2,
        action: 'PROJECT_DELETED',
        actorUserId: 10,
        projectId: 42,
        projectBefore: { name: 'A', description: '' },
        projectAfter: null,
        createdAt,
      },
      {
        id: 6,
        organizationId: 2,
        action: 'PROJECT_UPDATED',
        actorUserId: 10,
        projectId: 42,
        projectBefore: { name: 'A', description: null },
        projectAfter: { name: 'A', description: '' },
        createdAt,
      },
      {
        id: 5,
        organizationId: 2,
        action: 'PROJECT_CREATED',
        actorUserId: 10,
        projectId: 42,
        projectBefore: null,
        projectAfter: { name: 'A', description: null },
        createdAt,
      },
    ])
  })

  test('入力上限を超える名前・説明も切り詰めずに返す', async () => {
    const name = 'n'.repeat(300)
    const description = 'd'.repeat(5000)
    mockRows([{ ...projectRowBase, action: 'PROJECT_DELETED', projectBefore: { name, description }, projectAfter: null }])

    const result = await auditLogsRepository.findPage(2, 21, null)

    expect(result[0]).toMatchObject({ projectBefore: { name, description } })
  })

  const createdRow = { ...projectRowBase, action: 'PROJECT_CREATED', projectBefore: null, projectAfter: { name: 'A', description: null } }
  const updatedRow = {
    ...projectRowBase,
    action: 'PROJECT_UPDATED',
    projectBefore: { name: 'A', description: null },
    projectAfter: { name: 'B', description: null },
  }
  const deletedRow = { ...projectRowBase, action: 'PROJECT_DELETED', projectBefore: { name: 'A', description: null }, projectAfter: null }

  test.each<[string, unknown]>([
    ['未知のaction', { ...memberRow, action: 'PROJECT_ARCHIVED' }],
    ['actionがnull', { ...memberRow, action: null }],
    ['メンバーイベントのtargetUserIdがnull', { ...memberRow, targetUserId: null }],
    ['メンバーイベントのpreviousRoleがnull', { ...memberRow, previousRole: null }],
    ['MEMBER_ROLE_CHANGEDのnewRoleがnull', { ...memberRow, newRole: null }],
    ['MEMBER_REMOVEDのnewRoleがnullでない', { ...memberRow, action: 'MEMBER_REMOVED', newRole: 'ADMIN' }],
    ['不正なロール値', { ...memberRow, previousRole: 'SUPER' }],
    ['メンバーイベントにprojectIdが混入', { ...memberRow, projectId: 1 }],
    ['メンバーイベントにprojectAfterが混入', { ...memberRow, projectAfter: { name: 'A', description: null } }],
    ['プロジェクト向け列が欠落（undefined）', { ...memberRow, projectId: undefined }],
    ['プロジェクトイベントにtargetUserIdが混入', { ...createdRow, targetUserId: 1 }],
    ['プロジェクトイベントにnewRoleが混入', { ...createdRow, newRole: 'ADMIN' }],
    ['プロジェクトイベントのprojectIdがnull', { ...createdRow, projectId: null }],
    ['PROJECT_CREATEDにprojectBeforeが存在', { ...createdRow, projectBefore: { name: 'A', description: null } }],
    ['PROJECT_CREATEDのprojectAfterがnull', { ...createdRow, projectAfter: null }],
    ['PROJECT_UPDATEDのprojectBeforeがnull', { ...updatedRow, projectBefore: null }],
    ['PROJECT_UPDATEDのbeforeとafterが同値', { ...updatedRow, projectAfter: { name: 'A', description: null } }],
    ['PROJECT_DELETEDにprojectAfterが存在', { ...deletedRow, projectAfter: { name: 'A', description: null } }],
    ['スナップショットのdescriptionキー欠落', { ...createdRow, projectAfter: { name: 'A' } }],
    ['スナップショットのnameキー欠落', { ...createdRow, projectAfter: { description: null } }],
    ['スナップショットに余分なキー', { ...createdRow, projectAfter: { name: 'A', description: null, extra: 1 } }],
    ['スナップショットのnameが数値', { ...createdRow, projectAfter: { name: 1, description: null } }],
    ['スナップショットのnameがnull', { ...createdRow, projectAfter: { name: null, description: null } }],
    ['スナップショットのdescriptionが数値', { ...createdRow, projectAfter: { name: 'A', description: 1 } }],
    ['スナップショットが配列', { ...createdRow, projectAfter: [] }],
    ['スナップショットが文字列', { ...createdRow, projectAfter: 'x' }],
    // JSON null（'null'::jsonb）はデコード後にJSのnullとなるが、SQL NULLではないため補助booleanで区別して拒否する
    ['PROJECT_CREATEDのprojectBeforeがJSON null', { ...createdRow, projectBefore: null, projectBeforeIsSqlNull: false }],
    ['PROJECT_DELETEDのprojectAfterがJSON null', { ...deletedRow, projectAfter: null, projectAfterIsSqlNull: false }],
    ['MEMBER_ROLE_CHANGEDのprojectBeforeがJSON null', { ...memberRow, projectBefore: null, projectBeforeIsSqlNull: false }],
    ['MEMBER_ROLE_CHANGEDのprojectAfterがJSON null', { ...memberRow, projectAfter: null, projectAfterIsSqlNull: false }],
    [
      'MEMBER_REMOVEDのprojectBefore/AfterがJSON null',
      { ...memberRow, action: 'MEMBER_REMOVED', newRole: null, projectBeforeIsSqlNull: false, projectAfterIsSqlNull: false },
    ],
    ['OWNERSHIP_TRANSFERREDのprojectAfterがJSON null', { ...memberRow, action: 'OWNERSHIP_TRANSFERRED', projectAfterIsSqlNull: false }],
    ['PROJECT_UPDATEDのprojectBeforeがJSON null', { ...updatedRow, projectBefore: null, projectBeforeIsSqlNull: false }],
    ['PROJECT_UPDATEDのprojectAfterがJSON null', { ...updatedRow, projectAfter: null, projectAfterIsSqlNull: false }],
    ['PROJECT_CREATEDのprojectAfterがJSON null', { ...createdRow, projectAfter: null, projectAfterIsSqlNull: false }],
    ['PROJECT_DELETEDのprojectBeforeがJSON null', { ...deletedRow, projectBefore: null, projectBeforeIsSqlNull: false }],
    // 補助booleanの欠落・型違い・値との矛盾
    ['補助booleanが欠落', { ...memberRow, projectBeforeIsSqlNull: undefined }],
    ['補助booleanが文字列', { ...memberRow, projectAfterIsSqlNull: 'true' }],
    ['補助booleanがnull', { ...memberRow, projectBeforeIsSqlNull: null }],
    ['SQL NULLと判定されたのに値が存在', { ...createdRow, projectBefore: { name: 'A', description: null }, projectBeforeIsSqlNull: true }],
    ['必要なスナップショットがSQL NULL(補助booleanがtrue)', { ...deletedRow, projectBefore: { name: 'A', description: null }, projectBeforeIsSqlNull: true }],
    ['idが整数でない', { ...memberRow, id: '1' }],
    ['createdAtが日時でない', { ...memberRow, createdAt: '2026-01-01' }],
  ])('不整合な行（%s）は例外にして、他の行を読み飛ばさず一覧全体を失敗させる', async (_name, badRow) => {
    mockRows([memberRow, badRow, { ...memberRow, id: 9 }])

    await expect(auditLogsRepository.findPage(2, 21, null)).rejects.toThrow()
  })

  test('正しいSQL NULL（補助booleanがtrue）を持つ行は受理し、補助booleanをEntityへ含めない', async () => {
    mockRows([
      { ...createdRow, id: 11 },
      { ...deletedRow, id: 12 },
      { ...memberRow, id: 13 },
      { ...createdRow, id: 14, projectAfter: { name: 'A', description: null } },
    ])

    const result = await auditLogsRepository.findPage(2, 21, null)

    expect(result.map((r) => r.id)).toEqual([11, 12, 13, 14])
    for (const entity of result) {
      expect(entity).not.toHaveProperty('projectBeforeIsSqlNull')
      expect(entity).not.toHaveProperty('projectAfterIsSqlNull')
    }
    expect(result[0]).toMatchObject({ projectBefore: null, projectAfter: { name: 'A', description: null } })
    expect(result[1]).toMatchObject({ projectBefore: { name: 'A', description: null }, projectAfter: null })
  })

  test('スナップショット内のdescriptionのJSON nullは有効で、SQL NULLの判定には影響しない', async () => {
    mockRows([{ ...createdRow, projectAfter: { name: 'A', description: null }, projectBeforeIsSqlNull: true, projectAfterIsSqlNull: false }])

    const [entity] = await auditLogsRepository.findPage(2, 21, null)

    expect(entity).toMatchObject({ action: 'PROJECT_CREATED', projectAfter: { name: 'A', description: null } })
  })

  test('SELECTはSQLの IS NULL 判定を補助booleanとして取得する', async () => {
    queryRaw.mockResolvedValue([])

    await auditLogsRepository.findPage(2, 21, null)

    const sql = (queryRaw.mock.calls[0]?.[0] as Prisma.Sql).sql
    expect(sql).toContain('"projectBefore" IS NULL AS "projectBeforeIsSqlNull"')
    expect(sql).toContain('"projectAfter" IS NULL AS "projectAfterIsSqlNull"')
  })

  test('不整合の例外メッセージにプロジェクトの名前・説明を含めない', async () => {
    mockRows([{ ...createdRow, projectAfter: { name: '秘密の名前', description: 5 } }])

    await expect(auditLogsRepository.findPage(2, 21, null)).rejects.toThrow(/^(?!.*秘密の名前)/)
  })

  test('予期しないDBエラーはそのままthrowする', async () => {
    queryRaw.mockRejectedValue(new Error('接続エラー'))

    await expect(auditLogsRepository.findPage(2, 21, null)).rejects.toThrow('接続エラー')
  })
})
