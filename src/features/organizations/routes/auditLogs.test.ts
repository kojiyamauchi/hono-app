import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { sign } from 'hono/jwt'

import type { AuditLog, MemberRoleChangedAuditLog } from '@/features/organizations/entities/auditLogs'
import type { Membership, Role } from '@/shared/membership/entities'

import { createRouteTestContext } from './testSupport'

const context = await createRouteTestContext()
const { app } = context
const { findByUserAndOrganization } = context.mocks.memberships
const { findPage: findAuditLogPage } = context.mocks.auditLogs

const membershipWithRole = (role: Role): Membership => ({
  id: 1,
  userId: 1,
  organizationId: 1,
  role,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
})

const createToken = async (userId: number): Promise<string> => {
  return sign({ sub: userId, exp: Math.floor(Date.now() / 1000) + 60 }, 'test-secret')
}

afterEach(() => {
  context.assertNoUnexpectedCalls()
})

afterAll(() => {
  context.cleanup()
})

describe('organizations audit-logs routes', () => {
  beforeEach(() => {
    context.reset()
  })

  const auditLog = (id: number, createdAt = '2026-01-01T00:00:00.000Z'): MemberRoleChangedAuditLog => ({
    id,
    organizationId: 1,
    action: 'MEMBER_ROLE_CHANGED',
    actorUserId: 1,
    targetUserId: 2,
    targetMembershipId: 10,
    previousRole: 'MEMBER',
    newRole: 'ADMIN',
    createdAt: new Date(createdAt),
  })

  const auditLogsRequest = async (path: string, token?: string): Promise<Response> =>
    app.request(path, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)

  // 認証 → パス検証 → 所属確認 → ロール確認 → query検証の順
  test('GET /organizations/:id/audit-logs は未認証なら不正queryでも401を返す', async () => {
    const response = await auditLogsRequest('/organizations/1/audit-logs?limit=0')

    expect(response.status).toBe(401)
    expect(findByUserAndOrganization).not.toHaveBeenCalled()
    expect(findAuditLogPage).not.toHaveBeenCalled()
  })

  test('GET /organizations/:id/audit-logs は不正な組織IDなら（不正queryでも）400を返し所属確認へ進まない', async () => {
    const token = await createToken(1)

    const response = await auditLogsRequest('/organizations/not-number/audit-logs?limit=0', token)

    expect(response.status).toBe(400)
    expect(findByUserAndOrganization).not.toHaveBeenCalled()
    expect(findAuditLogPage).not.toHaveBeenCalled()
  })

  // PostgreSQL INTEGERの上限（2147483647）を超える組織IDは、DBの整数変換で500になるため所属確認の前に400にする
  test.each(['2147483648', '9007199254740991'])(
    'GET /organizations/%s/audit-logs は上限を超える組織IDなら400を返し所属確認へ進まない',
    async (organizationId) => {
      const token = await createToken(1)

      const response = await auditLogsRequest(`/organizations/${organizationId}/audit-logs`, token)

      expect(response.status).toBe(400)
      const body = (await response.json()) as { error?: { message?: string } }
      expect(body.error?.message).toContain('2147483647以下')
      expect(findByUserAndOrganization).not.toHaveBeenCalled()
      expect(findAuditLogPage).not.toHaveBeenCalled()
    },
  )

  test('GET /organizations/2147483647/audit-logs は上限ちょうどの組織IDならパス検証を通過して所属確認へ進む', async () => {
    findByUserAndOrganization.mockResolvedValue(null)
    const token = await createToken(1)

    const response = await auditLogsRequest('/organizations/2147483647/audit-logs', token)

    expect(response.status).toBe(404)
    expect(findByUserAndOrganization).toHaveBeenCalledWith(1, 2147483647)
    expect(findAuditLogPage).not.toHaveBeenCalled()
  })

  test('GET /organizations/:id/audit-logs は未所属・存在しない組織なら不正queryでも404を返す', async () => {
    findByUserAndOrganization.mockResolvedValue(null)
    const token = await createToken(1)

    const response = await auditLogsRequest('/organizations/1/audit-logs?limit=0', token)

    expect(response.status).toBe(404)
    expect(findAuditLogPage).not.toHaveBeenCalled()
  })

  test.each(['', '?limit=0', '?cursor=invalid', '?offset=0'])(
    'GET /organizations/:id/audit-logs%s はMEMBERなら403を返しrepositoryを呼ばない',
    async (query) => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('MEMBER'))
      const token = await createToken(1)

      const response = await auditLogsRequest(`/organizations/1/audit-logs${query}`, token)

      expect(response.status).toBe(403)
      expect(findAuditLogPage).not.toHaveBeenCalled()
    },
  )

  test.each<Role>(['OWNER', 'ADMIN'])('GET /organizations/:id/audit-logs は%sなら200で記録を新しい順のDTOで返す', async (role) => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole(role))
    findAuditLogPage.mockResolvedValue([auditLog(2, '2026-01-02T00:00:00.000Z'), auditLog(1)])
    const token = await createToken(1)

    const response = await auditLogsRequest('/organizations/1/audit-logs', token)

    expect(response.status).toBe(200)
    const body = (await response.json()) as { items: Record<string, unknown>[]; nextCursor: string | null }
    expect(body.items.map((item) => item.id)).toEqual([2, 1])
    expect(body.items[0]).toEqual({
      id: 2,
      organizationId: 1,
      action: 'MEMBER_ROLE_CHANGED',
      actorUserId: 1,
      targetUserId: 2,
      targetMembershipId: 10,
      previousRole: 'MEMBER',
      newRole: 'ADMIN',
      createdAt: '2026-01-02T00:00:00.000Z',
    })
    expect(body.nextCursor).toBeNull()
    // 認可済みの組織IDで絞り込み、次ページ判定のためlimit + 1件を要求する
    expect(findAuditLogPage).toHaveBeenCalledWith(1, 21, null)
  })

  test('GET /organizations/:id/audit-logs は0件なら空のitemsとnextCursor: nullを返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    findAuditLogPage.mockResolvedValue([])
    const token = await createToken(1)

    const response = await auditLogsRequest('/organizations/1/audit-logs', token)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ items: [], nextCursor: null })
  })

  test('GET /organizations/:id/audit-logs は同一createdAtの複数件でも、nextCursorの境界で重複・欠落なく続きを取得できる', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    const sameCreatedAt = '2026-01-01T00:00:00.000Z'
    const token = await createToken(1)

    // 1ページ目: limit=2 に対して3件を返す（次ページあり）。同一createdAtで id の降順
    findAuditLogPage.mockResolvedValueOnce([auditLog(12, sameCreatedAt), auditLog(11, sameCreatedAt), auditLog(10, sameCreatedAt)])
    const first = await auditLogsRequest('/organizations/1/audit-logs?limit=2', token)
    const firstBody = (await first.json()) as { items: { id: number }[]; nextCursor: string | null }

    expect(first.status).toBe(200)
    expect(firstBody.items.map((item) => item.id)).toEqual([12, 11])
    expect(firstBody.nextCursor).not.toBeNull()

    // 2ページ目: 最後に返したitem(id 11)を境界にし、残り1件で最終ページ
    findAuditLogPage.mockResolvedValueOnce([auditLog(10, sameCreatedAt)])
    const second = await auditLogsRequest(`/organizations/1/audit-logs?limit=2&cursor=${firstBody.nextCursor}`, token)
    const secondBody = (await second.json()) as { items: { id: number }[]; nextCursor: string | null }

    expect(second.status).toBe(200)
    expect(findAuditLogPage).toHaveBeenLastCalledWith(1, 3, { createdAt: new Date(sameCreatedAt), id: 11 })
    expect(secondBody.items.map((item) => item.id)).toEqual([10])
    expect(secondBody.nextCursor).toBeNull()
  })

  test('GET /organizations/:id/audit-logs は3種のイベントが混在しても同じ順序規則でページをまたいで取得でき、MEMBER_REMOVEDのnewRoleはnullで返る', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('ADMIN'))
    const sameCreatedAt = '2026-01-01T00:00:00.000Z'
    const removed = (id: number): AuditLog => ({ ...auditLog(id, sameCreatedAt), action: 'MEMBER_REMOVED', previousRole: 'ADMIN', newRole: null })
    const transferred = (id: number): AuditLog => ({ ...auditLog(id, sameCreatedAt), action: 'OWNERSHIP_TRANSFERRED', previousRole: 'ADMIN', newRole: 'OWNER' })
    const token = await createToken(1)

    findAuditLogPage.mockResolvedValueOnce([removed(4), transferred(3), auditLog(2, sameCreatedAt)])
    const first = await auditLogsRequest('/organizations/1/audit-logs?limit=2', token)
    const firstBody = (await first.json()) as { items: { id: number; action: string; newRole: string | null }[]; nextCursor: string | null }

    expect(first.status).toBe(200)
    expect(firstBody.items.map((item) => [item.id, item.action])).toEqual([
      [4, 'MEMBER_REMOVED'],
      [3, 'OWNERSHIP_TRANSFERRED'],
    ])
    // newRoleは常にキーを返し、削除イベントはnull、既存2種はロール値
    expect(firstBody.items[0]).toHaveProperty('newRole', null)
    expect(firstBody.items[1].newRole).toBe('OWNER')
    expect(firstBody.nextCursor).not.toBeNull()

    findAuditLogPage.mockResolvedValueOnce([auditLog(2, sameCreatedAt), auditLog(1, sameCreatedAt)])
    const second = await auditLogsRequest(`/organizations/1/audit-logs?limit=2&cursor=${firstBody.nextCursor}`, token)
    const secondBody = (await second.json()) as { items: { id: number; action: string; newRole: string | null }[]; nextCursor: string | null }

    expect(second.status).toBe(200)
    expect(findAuditLogPage).toHaveBeenLastCalledWith(1, 3, { createdAt: new Date(sameCreatedAt), id: 3 })
    expect(secondBody.items.map((item) => [item.id, item.action, item.newRole])).toEqual([
      [2, 'MEMBER_ROLE_CHANGED', 'ADMIN'],
      [1, 'MEMBER_ROLE_CHANGED', 'ADMIN'],
    ])
    expect(secondBody.nextCursor).toBeNull()
  })

  test('GET /organizations/:id/audit-logs は既存3イベントとプロジェクト3イベントの6種が混在しても、イベントごとの形で返す', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    const at = '2026-01-01T00:00:00.000Z'
    const base = { organizationId: 1, actorUserId: 1, createdAt: new Date(at) }
    const items: AuditLog[] = [
      { ...base, id: 6, action: 'PROJECT_DELETED', projectId: 9, projectBefore: { name: 'B', description: '' }, projectAfter: null },
      {
        ...base,
        id: 5,
        action: 'PROJECT_UPDATED',
        projectId: 9,
        projectBefore: { name: 'A', description: null },
        projectAfter: { name: 'B', description: '' },
      },
      { ...base, id: 4, action: 'PROJECT_CREATED', projectId: 9, projectBefore: null, projectAfter: { name: 'A', description: null } },
      { ...auditLog(3, at), action: 'MEMBER_REMOVED', previousRole: 'ADMIN', newRole: null },
      { ...auditLog(2, at), action: 'OWNERSHIP_TRANSFERRED', previousRole: 'ADMIN', newRole: 'OWNER' },
      auditLog(1, at),
    ]
    findAuditLogPage.mockResolvedValueOnce(items)

    const response = await auditLogsRequest('/organizations/1/audit-logs', await createToken(1))
    const body = (await response.json()) as { items: Record<string, unknown>[]; nextCursor: string | null }

    expect(response.status).toBe(200)
    expect(body.items.map((item) => item.action)).toEqual([
      'PROJECT_DELETED',
      'PROJECT_UPDATED',
      'PROJECT_CREATED',
      'MEMBER_REMOVED',
      'OWNERSHIP_TRANSFERRED',
      'MEMBER_ROLE_CHANGED',
    ])
    // プロジェクトイベントは共通項目 + projectId + before/after のみ（メンバー向けキー・projectBefore/Afterを返さない）
    expect(body.items[0]).toEqual({
      id: 6,
      organizationId: 1,
      action: 'PROJECT_DELETED',
      actorUserId: 1,
      createdAt: at,
      projectId: 9,
      before: { name: 'B', description: '' },
      after: null,
    })
    expect(body.items[1]).toMatchObject({ before: { name: 'A', description: null }, after: { name: 'B', description: '' } })
    expect(body.items[2]).toMatchObject({ before: null, after: { name: 'A', description: null } })
    // 既存3イベントにはプロジェクト向けキーを追加しない
    for (const item of body.items.slice(3)) {
      expect(item).not.toHaveProperty('projectId')
      expect(item).not.toHaveProperty('before')
      expect(item).not.toHaveProperty('after')
      expect(item).toHaveProperty('newRole')
    }
    expect(body.items[3]).toHaveProperty('newRole', null)
  })

  test('GET /organizations/:id/audit-logs は読み取り境界が不整合な行を検出して失敗したら一覧全体を500にする', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
    findAuditLogPage.mockRejectedValueOnce(new Error('監査ログの行が不正です'))

    const response = await auditLogsRequest('/organizations/1/audit-logs', await createToken(1))

    expect(response.status).toBe(500)
    expect(await response.json()).not.toHaveProperty('items')
  })

  test('GET /organizations/:id/audit-logs はMEMBERを403で拒否する（プロジェクトを閲覧できても監査ログの権限は追加されない）', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('MEMBER'))

    const response = await auditLogsRequest('/organizations/1/audit-logs', await createToken(1))

    expect(response.status).toBe(403)
  })

  const encodeCursorPayload = (payload: Record<string, unknown>): string => Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const validAuditCursorPayload = { kind: 'auditLogs', version: 1, organizationId: 1, createdAt: '2026-01-01T00:00:00.000Z', id: 3 }

  test.each([
    ['limit=0'],
    ['limit=101'],
    ['limit='],
    ['cursor='],
    ['cursor=invalid'],
    ['offset=0'],
    // 別組織で発行されたカーソル
    [`cursor=${encodeCursorPayload({ ...validAuditCursorPayload, organizationId: 2 })}`],
    // メンバー一覧のカーソル（kindなし）
    [`cursor=${encodeCursorPayload({ version: 1, organizationId: 1, createdAt: '2026-01-01T00:00:00.000Z', id: 3 })}`],
    // 別種別のカーソル
    [`cursor=${encodeCursorPayload({ ...validAuditCursorPayload, kind: 'members' })}`],
    // PostgreSQLで扱えない0年の日時
    [`cursor=${encodeCursorPayload({ ...validAuditCursorPayload, createdAt: '0000-01-01T00:00:00.000Z' })}`],
    // 有効なカーソルの末尾に不正な文字（`!`）を足した、正規のbase64urlではないカーソル
    [`cursor=${encodeCursorPayload(validAuditCursorPayload)}%21`],
    // PostgreSQL INTEGERの上限（2147483647）を超える境界idとカーソルの組織ID
    [`cursor=${encodeCursorPayload({ ...validAuditCursorPayload, id: 2147483648 })}`],
    [`cursor=${encodeCursorPayload({ ...validAuditCursorPayload, organizationId: 2147483648 })}`],
  ])('GET /organizations/:id/audit-logs?%s はOWNER/ADMINでも400を返しrepositoryを呼ばない', async (query) => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('ADMIN'))
    const token = await createToken(1)

    const response = await auditLogsRequest(`/organizations/1/audit-logs?${query}`, token)

    expect(response.status).toBe(400)
    const body = (await response.json()) as { error?: { message?: string } }
    expect(typeof body.error?.message).toBe('string')
    expect(findAuditLogPage).not.toHaveBeenCalled()
  })

  test('GET /organizations/:id/audit-logs は境界idが上限（2147483647）ちょうどのカーソルを有効として扱う', async () => {
    findByUserAndOrganization.mockResolvedValue(membershipWithRole('ADMIN'))
    findAuditLogPage.mockResolvedValue([])
    const token = await createToken(1)
    const cursor = encodeCursorPayload({ ...validAuditCursorPayload, id: 2147483647 })

    const response = await auditLogsRequest(`/organizations/1/audit-logs?cursor=${cursor}`, token)

    expect(response.status).toBe(200)
    expect(findAuditLogPage).toHaveBeenCalledWith(1, 21, { createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 2147483647 })
  })
})
