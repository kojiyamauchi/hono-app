import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { AuditLog } from '../../entities/auditLogs'
import { encodeAuditLogCursor } from '../../mappers/auditLogs'
import { encodeMemberListCursor } from '../../mappers/members'

const findAuditLogPage = mock()

await mock.module('@/features/organizations/repositories/auditLogs', () => ({
  auditLogsRepository: { findPage: findAuditLogPage },
}))

const { auditLogsService } = await import('../auditLogs')

describe('auditLogsService.list', () => {
  const auditLogs = (count: number): AuditLog[] =>
    Array.from({ length: count }, (_, index) => ({
      id: count - index,
      organizationId: 1,
      action: 'MEMBER_ROLE_CHANGED',
      actorUserId: 1,
      targetUserId: 2,
      targetMembershipId: 10,
      previousRole: 'MEMBER',
      newRole: 'ADMIN',
      // 新しい順（createdAt, idとも降順）
      createdAt: new Date(Date.UTC(2026, 0, count - index)),
    }))

  beforeEach(() => {
    findAuditLogPage.mockReset()
  })

  test('cursorなしなら境界なしで、次ページ判定のためlimit + 1件をrepositoryへ要求する', async () => {
    findAuditLogPage.mockResolvedValue([])

    await auditLogsService.list(1, 20)

    expect(findAuditLogPage).toHaveBeenCalledWith(1, 21, null)
  })

  test('0件ならitemsは空でnextCursorはnullになる', async () => {
    findAuditLogPage.mockResolvedValue([])

    const result = await auditLogsService.list(1, 20)

    expect(result).toEqual({ items: [], nextCursor: null })
  })

  test('limit件ちょうど（最終ページ）ならnextCursorはnullになる', async () => {
    findAuditLogPage.mockResolvedValue(auditLogs(3))

    const result = await auditLogsService.list(1, 3)

    expect(result.items).toHaveLength(3)
    expect(result.nextCursor).toBeNull()
  })

  test('limitを超えて取得できたらitemsをlimit件に切り詰め、最後のitemの境界からnextCursorを作る', async () => {
    const rows = auditLogs(4)
    findAuditLogPage.mockResolvedValue(rows)

    const result = await auditLogsService.list(1, 3)

    expect(result.items.map((item) => item.id)).toEqual([4, 3, 2])
    expect(result.items[0]?.createdAt).toBe(rows[0]!.createdAt.toISOString())
    expect(result.nextCursor).toBe(encodeAuditLogCursor({ organizationId: 1, createdAt: rows[2]!.createdAt, id: 2 }))
  })

  test('cursor指定時はデコードした境界値をrepositoryへ渡す', async () => {
    findAuditLogPage.mockResolvedValue([])
    const createdAt = new Date('2026-01-03T00:00:00.000Z')
    const cursor = encodeAuditLogCursor({ organizationId: 1, createdAt, id: 3 })

    await auditLogsService.list(1, 20, cursor)

    expect(findAuditLogPage).toHaveBeenCalledWith(1, 21, { createdAt, id: 3 })
  })

  test('形式が不正なcursorは400エラーになりrepositoryを呼ばない', async () => {
    await expect(auditLogsService.list(1, 20, 'invalid')).rejects.toMatchObject({ statusCode: 400, message: 'カーソルが不正です' })

    expect(findAuditLogPage).not.toHaveBeenCalled()
  })

  test('別組織で発行されたcursorは400エラーになりrepositoryを呼ばない', async () => {
    const cursor = encodeAuditLogCursor({ organizationId: 2, createdAt: new Date('2026-01-03T00:00:00.000Z'), id: 3 })

    await expect(auditLogsService.list(1, 20, cursor)).rejects.toMatchObject({ statusCode: 400 })

    expect(findAuditLogPage).not.toHaveBeenCalled()
  })

  test('メンバー一覧のcursor（kindなし）は同じ組織でも400エラーになりrepositoryを呼ばない', async () => {
    const cursor = encodeMemberListCursor({ organizationId: 1, createdAt: new Date('2026-01-03T00:00:00.000Z'), id: 3 })

    await expect(auditLogsService.list(1, 20, cursor)).rejects.toMatchObject({ statusCode: 400 })

    expect(findAuditLogPage).not.toHaveBeenCalled()
  })
})
