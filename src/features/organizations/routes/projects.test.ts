import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { sign } from 'hono/jwt'

import type { Membership, Role } from '@/shared/membership/entities'

import type { Project } from '../entities/projects'
import { encodeProjectCursor } from '../mappers/projects'

process.env.JWT_SECRET = 'test-secret'

const findPageByOrganization = mock()
const findByOrganizationAndId = mock()
const createWithAuthorization = mock()
const updateWithAuthorization = mock()
const removeWithAuthorization = mock()
const findByUserAndOrganization = mock()
const existsById = mock()

await mock.module('@/features/organizations/repositories/projects', () => ({
  projectRepository: { findPageByOrganization, findByOrganizationAndId, createWithAuthorization, updateWithAuthorization, removeWithAuthorization },
  projectWriteResults: {
    succeeded: 'SUCCEEDED',
    organizationNotFound: 'ORGANIZATION_NOT_FOUND',
    projectNotFound: 'PROJECT_NOT_FOUND',
    rejected: 'REJECTED',
  },
}))
await mock.module('@/shared/membership/repositories', () => ({
  membershipRepository: { findByUserAndOrganization },
}))
await mock.module('@/shared/user/repositories', () => ({
  userRepository: { existsById },
}))

const { app } = await import('@/app')

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
const mockWrite = (repositoryMock: ReturnType<typeof mock>, role: Role, onAllowed: () => unknown): void => {
  repositoryMock.mockImplementation(async (_input: unknown, authorize: (state: { operatorRole: Role }) => unknown) => {
    const rejection = authorize({ operatorRole: role })
    return rejection !== null ? { status: 'REJECTED', rejection } : onAllowed()
  })
}

describe('organizations projects routes', () => {
  beforeEach(() => {
    findPageByOrganization.mockReset()
    findByOrganizationAndId.mockReset()
    createWithAuthorization.mockReset()
    updateWithAuthorization.mockReset()
    removeWithAuthorization.mockReset()
    findByUserAndOrganization.mockReset()
    existsById.mockReset()
    existsById.mockResolvedValue(true)
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
      createWithAuthorization.mockResolvedValue({ status: 'UNKNOWN' })
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

      updateWithAuthorization.mockResolvedValue({ status: 'UNKNOWN' })
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
