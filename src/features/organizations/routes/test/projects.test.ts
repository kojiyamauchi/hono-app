import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { sign } from 'hono/jwt'

import type { Membership, Role } from '@/shared/membership/entities'

import type { Project } from '../../entities/projects'
import type { Task, TaskStatus } from '../../entities/tasks'
import { encodeProjectCursor } from '../../mappers/projects'
import { encodeTaskCursor } from '../../mappers/tasks'
import { createRouteTestContext } from './testSupport'

const context = await createRouteTestContext()
const { app } = context
const {
  findPage: findPageByOrganization,
  findByOrganizationAndId,
  createWithAuthorization,
  updateWithAuthorization,
  removeWithAuthorization,
} = context.mocks.projects
const { findByUserAndOrganization } = context.mocks.memberships
const tasks = context.mocks.tasks

const membershipWithRole = (role: Role): Membership => ({
  id: 1,
  userId: 1,
  organizationId: 1,
  role,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
})

const makeProject = (id: number, overrides: Partial<Project> = {}): Project => ({
  id,
  organizationId: 1,
  name: `Project ${id}`,
  description: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  ...overrides,
})

const makeTask = (id: number, overrides: Partial<Task> = {}): Task => ({
  id,
  projectId: 2,
  title: `Task ${id}`,
  description: null,
  status: 'TODO',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  ...overrides,
})

const createToken = async (userId: number): Promise<string> => sign({ sub: userId, exp: Math.floor(Date.now() / 1000) + 60 }, 'test-secret')

const request = async (method: string, path: string, options: { token?: string; body?: unknown } = {}): Promise<Response> => {
  const headers: Record<string, string> = {}
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  return app.request(path, { method, headers, body: options.body !== undefined ? JSON.stringify(options.body) : undefined })
}

/** repositoryの書き込みモックを、指定ロールの認可コールバックを実行したうえで結果を返す実装にする。 */
const mockWrite = (
  repositoryMock: typeof createWithAuthorization | typeof updateWithAuthorization | typeof removeWithAuthorization,
  role: Role,
  onAllowed: () => unknown,
): void => {
  // 3つの書き込みRepositoryで入力型が異なるため、認可コールバックを実行する共通実装として型を迂回する
  const setImplementation = repositoryMock.mockImplementation as (implementation: unknown) => unknown
  setImplementation.call(repositoryMock, async (_input: unknown, authorize: (state: { operatorRole: Role }) => unknown) => {
    const rejection = authorize({ operatorRole: role })
    return rejection !== null ? { status: 'REJECTED', rejection } : onAllowed()
  })
}

afterEach(() => {
  context.assertNoUnexpectedCalls()
})

afterAll(() => {
  context.cleanup()
})

describe('organizations projects routes', () => {
  beforeEach(() => {
    context.reset()
  })

  describe('認証・パス・所属', () => {
    const requests: [string, string, unknown][] = [
      ['GET', '/organizations/1/projects', undefined],
      ['POST', '/organizations/1/projects', { name: 'a' }],
      ['GET', '/organizations/1/projects/2', undefined],
      ['PATCH', '/organizations/1/projects/2', { name: 'a' }],
      ['DELETE', '/organizations/1/projects/2', undefined],
    ]

    test.each(requests)('%s %s は未認証なら401を返す', async (method, path, body) => {
      const response = await request(method, path, { body })

      expect(response.status).toBe(401)
      expect(findByUserAndOrganization).not.toHaveBeenCalled()
    })

    test.each(['/organizations/x/projects/2', '/organizations/1/projects/x', '/organizations/2147483648/projects/2', '/organizations/1/projects/2147483648'])(
      '不正なパスパラメータ %s は（不正bodyでも）400を返し所属確認へ進まない',
      async (path) => {
        const token = await createToken(1)

        for (const method of ['GET', 'PATCH', 'DELETE']) {
          const response = await request(method, path, { token, body: method === 'PATCH' ? {} : undefined })
          expect(response.status).toBe(400)
        }
        expect(findByUserAndOrganization).not.toHaveBeenCalled()
      },
    )

    test('一覧・作成も不正な組織IDなら400を返す', async () => {
      const token = await createToken(1)

      expect((await request('GET', '/organizations/x/projects', { token })).status).toBe(400)
      expect((await request('POST', '/organizations/2147483648/projects', { token, body: { name: 'a' } })).status).toBe(400)
      expect(findByUserAndOrganization).not.toHaveBeenCalled()
    })

    test.each(requests)('%s %s は未所属・存在しない組織なら（不正bodyでも）404を返す', async (method, path, body) => {
      findByUserAndOrganization.mockResolvedValue(null)
      const token = await createToken(1)

      const response = await request(method, path, { token, body: body === undefined ? undefined : {} })

      expect(response.status).toBe(404)
      expect(findPageByOrganization).not.toHaveBeenCalled()
      expect(createWithAuthorization).not.toHaveBeenCalled()
      expect(updateWithAuthorization).not.toHaveBeenCalled()
      expect(removeWithAuthorization).not.toHaveBeenCalled()
    })
  })

  describe('GET /organizations/:id/projects', () => {
    test.each<Role>(['OWNER', 'ADMIN', 'MEMBER'])('%sは一覧を取得でき、既定のlimit 20 で limit + 1 件を取得する', async (role) => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole(role))
      findPageByOrganization.mockResolvedValue([makeProject(2), makeProject(1)])
      const token = await createToken(1)

      const response = await request('GET', '/organizations/1/projects', { token })

      expect(response.status).toBe(200)
      const body = (await response.json()) as { items: { id: number; description: null }[]; nextCursor: string | null }
      expect(body.items.map((item) => item.id)).toEqual([2, 1])
      expect(body.items[0]?.description).toBeNull()
      expect(body.nextCursor).toBeNull()
      expect(findPageByOrganization).toHaveBeenCalledWith(1, 21, null)
    })

    test('後続があればnextCursorを返し、そのカーソルで続きを取得できる', async () => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('MEMBER'))
      findPageByOrganization.mockResolvedValueOnce([makeProject(3), makeProject(2), makeProject(1)])
      const token = await createToken(1)

      const first = await request('GET', '/organizations/1/projects?limit=2', { token })
      const firstBody = (await first.json()) as { items: unknown[]; nextCursor: string }
      expect(firstBody.items).toHaveLength(2)
      expect(firstBody.nextCursor).toEqual(expect.any(String))

      findPageByOrganization.mockResolvedValueOnce([makeProject(1)])
      const second = await request('GET', `/organizations/1/projects?limit=2&cursor=${firstBody.nextCursor}`, { token })

      expect(second.status).toBe(200)
      expect(findPageByOrganization).toHaveBeenLastCalledWith(1, 3, { createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 2 })
    })

    test.each(['?limit=0', '?limit=101', '?limit=', '?cursor=', '?cursor=%20', '?offset=0', '?offset=', '?foo=bar', '?cursor=invalid'])(
      'GET /organizations/1/projects%s は400を返しrepositoryを呼ばない',
      async (query) => {
        findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
        const token = await createToken(1)

        const response = await request('GET', `/organizations/1/projects${query}`, { token })

        expect(response.status).toBe(400)
        expect(findPageByOrganization).not.toHaveBeenCalled()
      },
    )

    test('別組織で発行されたカーソルは400', async () => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
      const token = await createToken(1)
      const cursor = encodeProjectCursor({ organizationId: 2, createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 1 })

      const response = await request('GET', `/organizations/1/projects?cursor=${cursor}`, { token })

      expect(response.status).toBe(400)
      expect(findPageByOrganization).not.toHaveBeenCalled()
    })
  })

  describe('POST /organizations/:id/projects', () => {
    test.each<Role>(['OWNER', 'ADMIN'])('%sはプロジェクトを作成でき、201で6項目のDTOを返す', async (role) => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole(role))
      mockWrite(createWithAuthorization, role, () => ({ status: 'SUCCEEDED', value: makeProject(5, { name: 'Alpha' }) }))
      const token = await createToken(1)

      const response = await request('POST', '/organizations/1/projects', { token, body: { name: '  Alpha  ' } })

      expect(response.status).toBe(201)
      expect(await response.json()).toEqual({
        id: 5,
        organizationId: 1,
        name: 'Alpha',
        description: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      })
      // nameはtrimされ、省略されたdescriptionはnullとして渡る。操作者は認証済みユーザーID
      expect(createWithAuthorization.mock.calls[0]?.[0]).toEqual({ organizationId: 1, actorUserId: 1, name: 'Alpha', description: null })
    })

    test('MEMBERは不正なbodyでも403を返しrepositoryを呼ばない', async () => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('MEMBER'))
      const token = await createToken(1)

      for (const body of [{ name: 'Alpha' }, {}, { name: '' }]) {
        expect((await request('POST', '/organizations/1/projects', { token, body })).status).toBe(403)
      }
      expect(createWithAuthorization).not.toHaveBeenCalled()
    })

    test.each([
      ['bodyなし', undefined],
      ['nameなし', {}],
      ['空白のみのname', { name: '   ' }],
      ['101文字のname', { name: 'a'.repeat(101) }],
      ['2001文字のdescription', { name: 'a', description: 'a'.repeat(2001) }],
      ['未知の項目', { name: 'a', organizationId: 2 }],
    ])('不正な入力（%s）は400を返しrepositoryを呼ばない', async (_name, body) => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
      const token = await createToken(1)

      const response = await request('POST', '/organizations/1/projects', { token, body })

      expect(response.status).toBe(400)
      expect(createWithAuthorization).not.toHaveBeenCalled()
    })

    test('同名のプロジェクト作成も拒否しない', async () => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
      mockWrite(createWithAuthorization, 'OWNER', () => ({ status: 'SUCCEEDED', value: makeProject(6) }))
      const token = await createToken(1)

      expect((await request('POST', '/organizations/1/projects', { token, body: { name: 'Same' } })).status).toBe(201)
      expect((await request('POST', '/organizations/1/projects', { token, body: { name: 'Same' } })).status).toBe(201)
    })

    test('ロック後に所属が消えていた場合は404、ロールがMEMBERへ降格していた場合は403', async () => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
      const token = await createToken(1)

      createWithAuthorization.mockResolvedValue({ status: 'ORGANIZATION_NOT_FOUND' })
      expect((await request('POST', '/organizations/1/projects', { token, body: { name: 'a' } })).status).toBe(404)

      mockWrite(createWithAuthorization, 'MEMBER', () => ({ status: 'SUCCEEDED', value: makeProject(5) }))
      expect((await request('POST', '/organizations/1/projects', { token, body: { name: 'a' } })).status).toBe(403)
    })

    test('未知のrepository結果は500', async () => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
      createWithAuthorization.mockResolvedValue({ status: 'UNKNOWN' } as never)
      const token = await createToken(1)

      expect((await request('POST', '/organizations/1/projects', { token, body: { name: 'a' } })).status).toBe(500)
    })
  })

  describe('監査ログの保存に失敗した場合', () => {
    test('作成・更新・削除はいずれも例外が伝播して500になる（成功レスポンスを返さない）', async () => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
      const token = await createToken(1)
      createWithAuthorization.mockRejectedValue(new Error('ログINSERT失敗'))
      updateWithAuthorization.mockRejectedValue(new Error('ログINSERT失敗'))
      removeWithAuthorization.mockRejectedValue(new Error('ログINSERT失敗'))

      expect((await request('POST', '/organizations/1/projects', { token, body: { name: 'a' } })).status).toBe(500)
      expect((await request('PATCH', '/organizations/1/projects/2', { token, body: { name: 'a' } })).status).toBe(500)
      expect((await request('DELETE', '/organizations/1/projects/2', { token })).status).toBe(500)
    })
  })

  describe('GET /organizations/:id/projects/:projectId', () => {
    test.each<Role>(['OWNER', 'ADMIN', 'MEMBER'])('%sはプロジェクトを取得でき、組織IDとプロジェクトIDで検索する', async (role) => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole(role))
      findByOrganizationAndId.mockResolvedValue(makeProject(2, { description: '' }))
      const token = await createToken(1)

      const response = await request('GET', '/organizations/1/projects/2', { token })

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ id: 2, organizationId: 1, description: '' })
      expect(findByOrganizationAndId).toHaveBeenCalledWith(1, 2)
    })

    test('指定組織内に存在しない（別組織のプロジェクトIDを含む）場合は404', async () => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
      findByOrganizationAndId.mockResolvedValue(null)
      const token = await createToken(1)

      const response = await request('GET', '/organizations/1/projects/999', { token })

      expect(response.status).toBe(404)
      expect(findByOrganizationAndId).toHaveBeenCalledWith(1, 999)
    })
  })

  describe('PATCH /organizations/:id/projects/:projectId', () => {
    test.each<Role>(['OWNER', 'ADMIN'])('%sは指定項目だけを更新でき、200で更新後のDTOを返す', async (role) => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole(role))
      mockWrite(updateWithAuthorization, role, () => ({ status: 'SUCCEEDED', value: makeProject(2, { name: 'Beta' }) }))
      const token = await createToken(1)

      const response = await request('PATCH', '/organizations/1/projects/2', { token, body: { name: 'Beta' } })

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ id: 2, name: 'Beta' })
      expect(updateWithAuthorization.mock.calls[0]?.[0]).toEqual({ organizationId: 1, projectId: 2, actorUserId: 1, data: { name: 'Beta' } })
    })

    test('description: null と空文字は説明の更新として渡り、省略した項目はdataに含めない', async () => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
      updateWithAuthorization.mockResolvedValue({ status: 'SUCCEEDED', value: makeProject(2) })
      const token = await createToken(1)

      await request('PATCH', '/organizations/1/projects/2', { token, body: { description: null } })
      await request('PATCH', '/organizations/1/projects/2', { token, body: { description: '' } })

      expect(updateWithAuthorization.mock.calls[0]?.[0]).toMatchObject({ data: { description: null } })
      expect(updateWithAuthorization.mock.calls[1]?.[0]).toMatchObject({ data: { description: '' } })
      expect(updateWithAuthorization.mock.calls[0]?.[0].data).not.toHaveProperty('name')
    })

    test('MEMBERは不正なbodyや存在しないプロジェクトでも403を返す', async () => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('MEMBER'))
      const token = await createToken(1)

      for (const body of [{ name: 'Beta' }, {}, { name: null }]) {
        expect((await request('PATCH', '/organizations/1/projects/999', { token, body })).status).toBe(403)
      }
      expect(updateWithAuthorization).not.toHaveBeenCalled()
    })

    test.each([
      ['bodyなし', undefined],
      ['空のbody', {}],
      ['name: null', { name: null }],
      ['空白のみのname', { name: '  ' }],
      ['未知の項目', { name: 'a', id: 3 }],
      ['organizationIdの変更', { organizationId: 2 }],
    ])('不正な入力（%s）は400を返しrepositoryを呼ばない', async (_name, body) => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
      const token = await createToken(1)

      const response = await request('PATCH', '/organizations/1/projects/2', { token, body })

      expect(response.status).toBe(400)
      expect(updateWithAuthorization).not.toHaveBeenCalled()
    })

    test('対象が存在しない（別組織のプロジェクトIDを含む）場合は404、未知の結果は500', async () => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
      const token = await createToken(1)

      updateWithAuthorization.mockResolvedValue({ status: 'PROJECT_NOT_FOUND' })
      expect((await request('PATCH', '/organizations/1/projects/999', { token, body: { name: 'a' } })).status).toBe(404)

      updateWithAuthorization.mockResolvedValue({ status: 'UNKNOWN' } as never)
      expect((await request('PATCH', '/organizations/1/projects/2', { token, body: { name: 'a' } })).status).toBe(500)
    })
  })

  describe('DELETE /organizations/:id/projects/:projectId', () => {
    test.each<Role>(['OWNER', 'ADMIN'])('%sは削除でき、204で本文なしを返す', async (role) => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole(role))
      mockWrite(removeWithAuthorization, role, () => ({ status: 'SUCCEEDED', value: null }))
      const token = await createToken(1)

      const response = await request('DELETE', '/organizations/1/projects/2', { token })

      expect(response.status).toBe(204)
      expect(await response.text()).toBe('')
      expect(removeWithAuthorization.mock.calls[0]?.[0]).toEqual({ organizationId: 1, projectId: 2, actorUserId: 1 })
    })

    test('MEMBERは対象の有無にかかわらず403を返しrepositoryを呼ばない', async () => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('MEMBER'))
      const token = await createToken(1)

      expect((await request('DELETE', '/organizations/1/projects/2', { token })).status).toBe(403)
      expect((await request('DELETE', '/organizations/1/projects/999', { token })).status).toBe(403)
      expect(removeWithAuthorization).not.toHaveBeenCalled()
    })

    test('再削除（削除済み）や別組織のプロジェクトIDは404', async () => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
      let deleted = false
      removeWithAuthorization.mockImplementation(async () => {
        if (deleted) {
          return { status: 'PROJECT_NOT_FOUND' }
        }
        deleted = true
        return { status: 'SUCCEEDED', value: null }
      })
      const token = await createToken(1)

      expect((await request('DELETE', '/organizations/1/projects/2', { token })).status).toBe(204)
      expect((await request('DELETE', '/organizations/1/projects/2', { token })).status).toBe(404)
    })
  })
})

describe('organizations project tasks routes', () => {
  beforeEach(() => {
    context.reset()
  })

  const base = '/organizations/1/projects/2/tasks'

  /** タスクの書き込みモックを、指定ロールの認可コールバックを実行したうえで結果を返す実装にする。 */
  const mockTaskWrite = (repositoryMock: typeof tasks.create | typeof tasks.update | typeof tasks.remove, role: Role, onAllowed: () => unknown): void => {
    // 3つの書き込みRepositoryで入力型が異なるため、認可コールバックを実行する共通実装として型を迂回する
    const setImplementation = repositoryMock.mockImplementation as (implementation: unknown) => unknown
    setImplementation.call(repositoryMock, async (_input: unknown, authorize: (state: { operatorRole: Role }) => unknown) => {
      const rejection = authorize({ operatorRole: role })
      return rejection !== null ? { status: 'REJECTED', rejection } : onAllowed()
    })
  }

  const expectNoRepositoryCalls = (): void => {
    for (const mockFn of Object.values(tasks)) {
      expect(mockFn).not.toHaveBeenCalled()
    }
  }

  describe('認証・パス・所属', () => {
    const requests: [string, string, unknown][] = [
      ['GET', base, undefined],
      ['POST', base, { title: 'a' }],
      ['GET', `${base}/3`, undefined],
      ['PATCH', `${base}/3`, { title: 'a' }],
      ['DELETE', `${base}/3`, undefined],
    ]

    test.each(requests)('%s %s は未認証なら401を返す', async (method, path, body) => {
      const response = await request(method, path, { body })

      expect(response.status).toBe(401)
      expect(findByUserAndOrganization).not.toHaveBeenCalled()
    })

    test.each([
      '/organizations/x/projects/2/tasks/3',
      '/organizations/1/projects/x/tasks/3',
      '/organizations/1/projects/2/tasks/x',
      '/organizations/2147483648/projects/2/tasks/3',
      '/organizations/1/projects/2147483648/tasks/3',
      '/organizations/1/projects/2/tasks/2147483648',
      '/organizations/1/projects/2/tasks/0',
    ])('不正なパスパラメータ %s は（不正bodyでも）400を返し所属確認へ進まない', async (path) => {
      const token = await createToken(1)

      for (const method of ['GET', 'PATCH', 'DELETE']) {
        expect((await request(method, path, { token, body: method === 'PATCH' ? {} : undefined })).status).toBe(400)
      }
      expect(findByUserAndOrganization).not.toHaveBeenCalled()
    })

    test('一覧・作成も不正な組織ID・プロジェクトIDなら400を返す', async () => {
      const token = await createToken(1)

      expect((await request('GET', '/organizations/x/projects/2/tasks', { token })).status).toBe(400)
      expect((await request('GET', '/organizations/1/projects/2147483648/tasks', { token })).status).toBe(400)
      expect((await request('POST', '/organizations/1/projects/0/tasks', { token, body: { title: 'a' } })).status).toBe(400)
      expect(findByUserAndOrganization).not.toHaveBeenCalled()
    })

    test.each(requests)('%s %s は未所属・存在しない組織なら（不正bodyでも）404を返す', async (method, path, body) => {
      findByUserAndOrganization.mockResolvedValue(null)
      const token = await createToken(1)

      const response = await request(method, path, { token, body: body === undefined ? undefined : {} })

      expect(response.status).toBe(404)
      expectNoRepositoryCalls()
    })
  })

  describe('GET /organizations/:id/projects/:projectId/tasks', () => {
    test.each<Role>(['OWNER', 'ADMIN', 'MEMBER'])('%sは一覧を取得でき、既定のlimit 20 で limit + 1 件を取得する', async (role) => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole(role))
      tasks.projectExists.mockResolvedValue(true)
      tasks.list.mockResolvedValue([makeTask(2), makeTask(1, { description: '', status: 'DONE' })])
      const token = await createToken(1)

      const response = await request('GET', base, { token })

      expect(response.status).toBe(200)
      const body = (await response.json()) as { items: { id: number; description: string | null; status: string }[]; nextCursor: string | null }
      expect(body.items.map((item) => item.id)).toEqual([2, 1])
      expect(body.items[0]?.description).toBeNull()
      expect(body.items[1]).toMatchObject({ description: '', status: 'DONE' })
      expect(Object.keys(body.items[0] ?? {})).toHaveLength(7)
      expect(body.nextCursor).toBeNull()
      expect(tasks.projectExists).toHaveBeenCalledWith(1, 2)
      expect(tasks.list).toHaveBeenCalledWith(1, 2, null, 21, null)
    })

    test('親Projectが存在して0件なら200・items: []・nextCursor: nullを返す', async () => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
      tasks.projectExists.mockResolvedValue(true)
      tasks.list.mockResolvedValue([])
      const token = await createToken(1)

      const response = await request('GET', base, { token })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ items: [], nextCursor: null })
    })

    test('親Projectが指定組織内に存在しない（別組織のIDを含む）場合は404を返し、タスクを取得しない', async () => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
      tasks.projectExists.mockResolvedValue(false)
      const token = await createToken(1)

      expect((await request('GET', base, { token })).status).toBe(404)
      expect(tasks.list).not.toHaveBeenCalled()
    })

    test('statusを指定すると同じ取得条件として渡す', async () => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('MEMBER'))
      tasks.projectExists.mockResolvedValue(true)
      tasks.list.mockResolvedValue([])
      const token = await createToken(1)

      for (const status of ['TODO', 'IN_PROGRESS', 'DONE'] as TaskStatus[]) {
        expect((await request('GET', `${base}?status=${status}`, { token })).status).toBe(200)
        expect(tasks.list).toHaveBeenLastCalledWith(1, 2, status, 21, null)
      }
    })

    test('後続があればnextCursorを返し、そのカーソルで続きを取得できる（状態フィルターも維持）', async () => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('MEMBER'))
      tasks.projectExists.mockResolvedValue(true)
      tasks.list.mockResolvedValueOnce([makeTask(3), makeTask(2), makeTask(1)])
      const token = await createToken(1)

      const first = await request('GET', `${base}?limit=2&status=TODO`, { token })
      const firstBody = (await first.json()) as { items: unknown[]; nextCursor: string }
      expect(firstBody.items).toHaveLength(2)
      expect(firstBody.nextCursor).toEqual(expect.any(String))

      tasks.list.mockResolvedValueOnce([makeTask(1)])
      const second = await request('GET', `${base}?limit=2&status=TODO&cursor=${firstBody.nextCursor}`, { token })

      expect(second.status).toBe(200)
      expect(tasks.list).toHaveBeenLastCalledWith(1, 2, 'TODO', 3, { createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 2 })
    })

    test.each([
      '?limit=0',
      '?limit=101',
      '?limit=',
      '?cursor=',
      '?cursor=%20',
      '?status=',
      '?status=todo',
      '?status=CLOSED',
      '?status=TODO&status=DONE',
      '?offset=0',
      '?offset=',
      '?foo=bar',
      '?cursor=invalid',
    ])('GET %s は400を返し、親Projectの確認もしない', async (query) => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
      tasks.projectExists.mockResolvedValue(false)
      const token = await createToken(1)

      const response = await request('GET', `${base}${query}`, { token })

      expect(response.status).toBe(400)
      expectNoRepositoryCalls()
    })

    test.each([
      ['別組織', { organizationId: 9 }, ''],
      ['同一組織の別プロジェクト', { projectId: 9 }, ''],
      ['状態フィルター未指定のカーソルを状態指定で使用', {}, '&status=DONE'],
      ['異なる状態フィルター', { status: 'TODO' as const }, '&status=DONE'],
    ])('発行条件と異なるカーソル（%s）は400を返す', async (_name, overrides, extraQuery) => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
      const token = await createToken(1)
      const cursor = encodeTaskCursor({ organizationId: 1, projectId: 2, status: null, createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 1, ...overrides })

      const response = await request('GET', `${base}?cursor=${cursor}${extraQuery}`, { token })

      expect(response.status).toBe(400)
      expectNoRepositoryCalls()
    })

    test('他APIのカーソル（プロジェクト一覧）は400を返す', async () => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
      const token = await createToken(1)
      const cursor = encodeProjectCursor({ organizationId: 1, createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 1 })

      expect((await request('GET', `${base}?cursor=${cursor}`, { token })).status).toBe(400)
      expectNoRepositoryCalls()
    })
  })

  describe('POST /organizations/:id/projects/:projectId/tasks', () => {
    test.each<Role>(['OWNER', 'ADMIN', 'MEMBER'])('%sはタスクを作成でき、201で7項目のDTOを返す', async (role) => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole(role))
      mockTaskWrite(tasks.create, role, () => ({ status: 'SUCCEEDED', value: makeTask(5, { title: 'Alpha' }) }))
      const token = await createToken(1)

      const response = await request('POST', base, { token, body: { title: '  Alpha  ' } })

      expect(response.status).toBe(201)
      expect(await response.json()).toEqual({
        id: 5,
        projectId: 2,
        title: 'Alpha',
        description: null,
        status: 'TODO',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      })
      // titleはtrimされ、省略されたdescriptionはnull・statusはTODOとして渡る。操作者は認証済みユーザーID
      expect(tasks.create.mock.calls[0]?.[0]).toEqual({
        organizationId: 1,
        projectId: 2,
        actorUserId: 1,
        title: 'Alpha',
        description: null,
        status: 'TODO',
      })
    })

    test('作成時にdescription（空文字を含む）とIN_PROGRESS・DONEの状態を指定できる', async () => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('MEMBER'))
      tasks.create.mockResolvedValue({ status: 'SUCCEEDED', value: makeTask(5) })
      const token = await createToken(1)

      await request('POST', base, { token, body: { title: 'a', description: '', status: 'IN_PROGRESS' } })
      await request('POST', base, { token, body: { title: 'a', status: 'DONE' } })

      expect(tasks.create.mock.calls[0]?.[0]).toMatchObject({ description: '', status: 'IN_PROGRESS' })
      expect(tasks.create.mock.calls[1]?.[0]).toMatchObject({ description: null, status: 'DONE' })
    })

    test.each([
      ['bodyなし', undefined],
      ['titleなし', {}],
      ['title: null', { title: null }],
      ['空白のみのtitle', { title: '   ' }],
      ['201文字のtitle', { title: 'a'.repeat(201) }],
      ['2001文字のdescription', { title: 'a', description: 'a'.repeat(2001) }],
      ['status: null', { title: 'a', status: null }],
      ['不明なstatus', { title: 'a', status: 'CLOSED' }],
      ['未知の項目', { title: 'a', projectId: 3 }],
    ])('不正な入力（%s）は400を返しrepositoryを呼ばない', async (_name, body) => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
      const token = await createToken(1)

      const response = await request('POST', base, { token, body })

      expect(response.status).toBe(400)
      expectNoRepositoryCalls()
    })

    test('Content-Typeなしのbodyも検証を省略せず400を返す', async () => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
      const token = await createToken(1)

      const response = await app.request(base, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ title: 'a' }) })

      expect(response.status).toBe(400)
      expectNoRepositoryCalls()
    })

    test('同名のタスク作成も拒否しない', async () => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
      tasks.create.mockResolvedValue({ status: 'SUCCEEDED', value: makeTask(6) })
      const token = await createToken(1)

      expect((await request('POST', base, { token, body: { title: 'Same' } })).status).toBe(201)
      expect((await request('POST', base, { token, body: { title: 'Same' } })).status).toBe(201)
    })

    test('ロック後の所属消失・親Project消失は404、MEMBERへ降格しても作成でき、未知の結果は500', async () => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
      const token = await createToken(1)

      for (const status of ['ORGANIZATION_NOT_FOUND', 'PROJECT_NOT_FOUND'] as const) {
        tasks.create.mockResolvedValue({ status })
        expect((await request('POST', base, { token, body: { title: 'a' } })).status).toBe(404)
      }

      mockTaskWrite(tasks.create, 'MEMBER', () => ({ status: 'SUCCEEDED', value: makeTask(5) }))
      expect((await request('POST', base, { token, body: { title: 'a' } })).status).toBe(201)

      tasks.create.mockResolvedValue({ status: 'UNKNOWN' } as never)
      expect((await request('POST', base, { token, body: { title: 'a' } })).status).toBe(500)
    })
  })

  describe('GET /organizations/:id/projects/:projectId/tasks/:taskId', () => {
    test.each<Role>(['OWNER', 'ADMIN', 'MEMBER'])('%sはタスクを取得でき、組織・プロジェクト・タスクIDで検索する', async (role) => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole(role))
      tasks.getById.mockResolvedValue(makeTask(3, { description: '', status: 'DONE' }))
      const token = await createToken(1)

      const response = await request('GET', `${base}/3`, { token })

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ id: 3, projectId: 2, description: '', status: 'DONE' })
      expect(tasks.getById).toHaveBeenCalledWith(1, 2, 3)
    })

    test('指定組織・プロジェクト内に存在しない（別プロジェクトのタスクIDを含む）場合は404', async () => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
      tasks.getById.mockResolvedValue(null)
      const token = await createToken(1)

      expect((await request('GET', `${base}/999`, { token })).status).toBe(404)
      expect(tasks.getById).toHaveBeenCalledWith(1, 2, 999)
    })
  })

  describe('PATCH /organizations/:id/projects/:projectId/tasks/:taskId', () => {
    test.each<Role>(['OWNER', 'ADMIN', 'MEMBER'])('%sは指定項目だけを更新でき、200で更新後のDTOを返す', async (role) => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole(role))
      mockTaskWrite(tasks.update, role, () => ({ status: 'SUCCEEDED', value: makeTask(3, { status: 'DONE' }) }))
      const token = await createToken(1)

      const response = await request('PATCH', `${base}/3`, { token, body: { status: 'DONE' } })

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ id: 3, status: 'DONE' })
      expect(tasks.update.mock.calls[0]?.[0]).toEqual({
        organizationId: 1,
        projectId: 2,
        taskId: 3,
        actorUserId: 1,
        data: { status: 'DONE' },
      })
    })

    test('description: null と空文字は説明の更新として渡り、省略した項目はdataに含めない', async () => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
      tasks.update.mockResolvedValue({ status: 'SUCCEEDED', value: makeTask(3) })
      const token = await createToken(1)

      await request('PATCH', `${base}/3`, { token, body: { description: null } })
      await request('PATCH', `${base}/3`, { token, body: { description: '' } })

      expect(tasks.update.mock.calls[0]?.[0].data).toEqual({ description: null })
      expect(tasks.update.mock.calls[1]?.[0].data).toEqual({ description: '' })
    })

    test('3状態を往復でき、同値の更新も200', async () => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('MEMBER'))
      const token = await createToken(1)

      for (const status of ['IN_PROGRESS', 'DONE', 'TODO', 'TODO'] as TaskStatus[]) {
        tasks.update.mockResolvedValue({ status: 'SUCCEEDED', value: makeTask(3, { status }) })
        const response = await request('PATCH', `${base}/3`, { token, body: { status } })
        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({ status })
      }
    })

    test.each([
      ['bodyなし', undefined],
      ['空のbody', {}],
      ['title: null', { title: null }],
      ['status: null', { status: null }],
      ['不明なstatus', { status: 'CLOSED' }],
      ['空白のみのtitle', { title: '  ' }],
      ['未知の項目', { title: 'a', id: 3 }],
      ['projectIdの変更', { projectId: 3 }],
    ])('不正な入力（%s）は400を返しrepositoryを呼ばない', async (_name, body) => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
      const token = await createToken(1)

      const response = await request('PATCH', `${base}/3`, { token, body })

      expect(response.status).toBe(400)
      expectNoRepositoryCalls()
    })

    test('対象Task・親Projectが存在しない場合は404、未知の結果は500', async () => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
      const token = await createToken(1)

      for (const status of ['TASK_NOT_FOUND', 'PROJECT_NOT_FOUND', 'ORGANIZATION_NOT_FOUND'] as const) {
        tasks.update.mockResolvedValue({ status })
        expect((await request('PATCH', `${base}/999`, { token, body: { title: 'a' } })).status).toBe(404)
      }

      tasks.update.mockResolvedValue({ status: 'UNKNOWN' } as never)
      expect((await request('PATCH', `${base}/3`, { token, body: { title: 'a' } })).status).toBe(500)
    })
  })

  describe('DELETE /organizations/:id/projects/:projectId/tasks/:taskId', () => {
    test.each<Role>(['OWNER', 'ADMIN'])('%sは削除でき、204で本文なしを返す', async (role) => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole(role))
      mockTaskWrite(tasks.remove, role, () => ({ status: 'SUCCEEDED', value: null }))
      const token = await createToken(1)

      const response = await request('DELETE', `${base}/3`, { token })

      expect(response.status).toBe(204)
      expect(await response.text()).toBe('')
      expect(tasks.remove.mock.calls[0]?.[0]).toEqual({ organizationId: 1, projectId: 2, taskId: 3, actorUserId: 1 })
    })

    test('MEMBERは親ProjectやTaskの有無にかかわらず403を返しrepositoryを呼ばない', async () => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('MEMBER'))
      const token = await createToken(1)

      expect((await request('DELETE', `${base}/3`, { token })).status).toBe(403)
      expect((await request('DELETE', '/organizations/1/projects/999/tasks/999', { token })).status).toBe(403)
      expectNoRepositoryCalls()
    })

    test('ロック後にMEMBERへ降格していた場合は403を返す', async () => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
      mockTaskWrite(tasks.remove, 'MEMBER', () => ({ status: 'SUCCEEDED', value: null }))
      const token = await createToken(1)

      expect((await request('DELETE', `${base}/3`, { token })).status).toBe(403)
    })

    test('再削除（削除済み）や別プロジェクトのタスクIDは404', async () => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('OWNER'))
      let deleted = false
      tasks.remove.mockImplementation(async () => {
        if (deleted) {
          return { status: 'TASK_NOT_FOUND' }
        }
        deleted = true
        return { status: 'SUCCEEDED', value: null }
      })
      const token = await createToken(1)

      expect((await request('DELETE', `${base}/3`, { token })).status).toBe(204)
      expect((await request('DELETE', `${base}/3`, { token })).status).toBe(404)
    })

    test('親Projectが存在しない場合は404、未知の結果は500', async () => {
      findByUserAndOrganization.mockResolvedValue(membershipWithRole('ADMIN'))
      const token = await createToken(1)

      tasks.remove.mockResolvedValue({ status: 'PROJECT_NOT_FOUND' })
      expect((await request('DELETE', `${base}/3`, { token })).status).toBe(404)

      tasks.remove.mockResolvedValue({ status: 'UNKNOWN' } as never)
      expect((await request('DELETE', `${base}/3`, { token })).status).toBe(500)
    })
  })
})
