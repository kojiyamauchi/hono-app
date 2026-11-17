import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { Membership, Role } from '@/shared/membership/entities'
import type { AppError } from '@/utils/errors'

import { encodeMemberListCursor } from '../mappers/members'

const findPageByOrganization = mock()
const membershipCreate = mock()
const findByUserAndOrganization = mock()
const findByEmail = mock()
const leaveMember = mock()
const changeRole = mock()
const removeMember = mock()

await mock.module('@/features/organizations/repositories/members', () => ({
  membersRepository: { remove: removeMember, leave: leaveMember, changeRole: changeRole },
  memberRemovalResults: {
    removed: 'REMOVED',
    organizationNotFound: 'ORGANIZATION_NOT_FOUND',
    targetNotFound: 'TARGET_NOT_FOUND',
    rejected: 'REJECTED',
  },
  memberRoleChangeResults: {
    changed: 'CHANGED',
    unchanged: 'UNCHANGED',
    organizationNotFound: 'ORGANIZATION_NOT_FOUND',
    targetNotFound: 'TARGET_NOT_FOUND',
    rejected: 'REJECTED',
    conflict: 'CONFLICT',
  },
  leaveOrganizationResults: {
    left: 'LEFT',
    owner: 'OWNER',
    notMember: 'NOT_MEMBER',
    conflict: 'CONFLICT',
  },
}))

await mock.module('@/shared/membership/repositories', () => ({
  membershipRepository: {
    findByUserAndOrganization,
    findPageByOrganization,
    create: membershipCreate,
  },
}))
await mock.module('@/shared/user/repositories', () => ({
  userRepository: { findByEmail },
}))

const { membersService } = await import('./members')

const membership: Membership = {
  id: 10,
  userId: 2,
  organizationId: 1,
  role: 'MEMBER',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
}

describe('membersService.list', () => {
  const memberships = (count: number): Membership[] =>
    Array.from({ length: count }, (_, index) => ({ ...membership, id: index + 1, createdAt: new Date(Date.UTC(2026, 0, index + 1)) }))

  beforeEach(() => {
    findPageByOrganization.mockReset()
  })

  test('cursorなしなら境界なしで、次ページ判定のためlimit + 1件をrepositoryへ要求する', async () => {
    findPageByOrganization.mockResolvedValue([])

    await membersService.list(1, 20)

    expect(findPageByOrganization).toHaveBeenCalledWith(1, 21, null)
  })

  test('0件ならitemsは空でnextCursorはnullになる', async () => {
    findPageByOrganization.mockResolvedValue([])

    const result = await membersService.list(1, 20)

    expect(result).toEqual({ items: [], nextCursor: null })
  })

  test('limit件ちょうどならnextCursorはnullになる', async () => {
    findPageByOrganization.mockResolvedValue(memberships(3))

    const result = await membersService.list(1, 3)

    expect(result.items).toHaveLength(3)
    expect(result.nextCursor).toBeNull()
  })

  test('limitを超えて取得できたらitemsをlimit件に切り詰め、最後のitemの境界からnextCursorを作る', async () => {
    const rows = memberships(4)
    findPageByOrganization.mockResolvedValue(rows)

    const result = await membersService.list(1, 3)

    expect(result.items.map((item) => item.id)).toEqual([1, 2, 3])
    expect(result.nextCursor).toBe(encodeMemberListCursor({ organizationId: 1, createdAt: rows[2]!.createdAt, id: 3 }))
  })

  test('cursor指定時はデコードした境界値をrepositoryへ渡す', async () => {
    findPageByOrganization.mockResolvedValue([])
    const createdAt = new Date('2026-01-03T00:00:00.000Z')
    const cursor = encodeMemberListCursor({ organizationId: 1, createdAt, id: 3 })

    await membersService.list(1, 20, cursor)

    expect(findPageByOrganization).toHaveBeenCalledWith(1, 21, { createdAt, id: 3 })
  })

  test('形式が不正なcursorは400エラーになりrepositoryを呼ばない', async () => {
    await expect(membersService.list(1, 20, 'invalid')).rejects.toMatchObject({ statusCode: 400 })

    expect(findPageByOrganization).not.toHaveBeenCalled()
  })

  test('別組織で発行されたcursorは400エラーになりrepositoryを呼ばない', async () => {
    const cursor = encodeMemberListCursor({ organizationId: 2, createdAt: new Date('2026-01-03T00:00:00.000Z'), id: 3 })

    await expect(membersService.list(1, 20, cursor)).rejects.toMatchObject({ statusCode: 400 })

    expect(findPageByOrganization).not.toHaveBeenCalled()
  })
})

describe('membersService.add', () => {
  beforeEach(() => {
    findByEmail.mockReset()
    findByUserAndOrganization.mockReset()
    membershipCreate.mockReset()
  })

  test('OWNERはADMINを追加できる', async () => {
    findByEmail.mockResolvedValue({ id: 2, name: 'User', email: 'user@example.com', password: 'hash', createdAt: new Date(), updatedAt: new Date() })
    findByUserAndOrganization.mockResolvedValue(null)
    membershipCreate.mockResolvedValue({ ...membership, role: 'ADMIN' })

    const result = await membersService.add(1, 'OWNER', { email: 'user@example.com', role: 'ADMIN' })

    expect(result.role).toBe('ADMIN')
    expect(membershipCreate).toHaveBeenCalledWith(2, 1, 'ADMIN')
  })

  test('ADMINはMEMBERを追加できる', async () => {
    findByEmail.mockResolvedValue({ id: 2, name: 'User', email: 'user@example.com', password: 'hash', createdAt: new Date(), updatedAt: new Date() })
    findByUserAndOrganization.mockResolvedValue(null)
    membershipCreate.mockResolvedValue(membership)

    const result = await membersService.add(1, 'ADMIN', { email: 'user@example.com', role: 'MEMBER' })

    expect(result.role).toBe('MEMBER')
  })

  test('OWNERロール指定は422エラーを投げる', async () => {
    await expect(membersService.add(1, 'OWNER', { email: 'user@example.com', role: 'OWNER' })).rejects.toThrow('OWNERは追加できません')
    expect(membershipCreate).not.toHaveBeenCalled()
  })

  test('ADMINがADMINを追加しようとすると403エラーを投げる', async () => {
    await expect(membersService.add(1, 'ADMIN', { email: 'user@example.com', role: 'ADMIN' })).rejects.toThrow('ADMINはMEMBERのみ追加')
    expect(membershipCreate).not.toHaveBeenCalled()
  })

  test('MEMBERは操作できず403エラーを投げる', async () => {
    await expect(membersService.add(1, 'MEMBER', { email: 'user@example.com', role: 'MEMBER' })).rejects.toThrow('管理者以上')
    expect(membershipCreate).not.toHaveBeenCalled()
  })

  test('メールに一致するユーザーが存在しなければ404エラーを投げる', async () => {
    findByEmail.mockResolvedValue(null)

    await expect(membersService.add(1, 'OWNER', { email: 'notfound@example.com', role: 'MEMBER' })).rejects.toThrow('ユーザーが見つかりません')
    expect(membershipCreate).not.toHaveBeenCalled()
  })

  test('既にメンバーの場合は409エラーを投げる', async () => {
    findByEmail.mockResolvedValue({ id: 2, name: 'User', email: 'user@example.com', password: 'hash', createdAt: new Date(), updatedAt: new Date() })
    findByUserAndOrganization.mockResolvedValue(membership)

    await expect(membersService.add(1, 'OWNER', { email: 'user@example.com', role: 'MEMBER' })).rejects.toThrow('既にこの組織のメンバー')
    expect(membershipCreate).not.toHaveBeenCalled()
  })

  test('createがnullを返した場合（競合）は409エラーを投げる', async () => {
    findByEmail.mockResolvedValue({ id: 2, name: 'User', email: 'user@example.com', password: 'hash', createdAt: new Date(), updatedAt: new Date() })
    findByUserAndOrganization.mockResolvedValue(null)
    membershipCreate.mockResolvedValue(null)

    await expect(membersService.add(1, 'OWNER', { email: 'user@example.com', role: 'MEMBER' })).rejects.toThrow('既にこの組織のメンバー')
  })
})

describe('membersService.updateRole', () => {
  type LockedState = { operatorRole: Role; targetRole: Role }

  beforeEach(() => {
    changeRole.mockReset()
  })

  /**
   * repositoryがロック後に読み直したロールで認可コールバックを呼ぶ動きを再現する。
   * 拒否ならREJECTED、同一ロールならUNCHANGED、それ以外はCHANGEDを返す。
   */
  const simulateRepository = (locked: LockedState): void => {
    changeRole.mockImplementation(async (input: { newRole: Role }, authorize: (state: LockedState) => AppError | null) => {
      const rejection = authorize(locked)
      if (rejection !== null) {
        return { status: 'REJECTED', rejection }
      }
      if (locked.targetRole === input.newRole) {
        return { status: 'UNCHANGED', membership: { ...membership, role: locked.targetRole } }
      }
      return { status: 'CHANGED', membership: { ...membership, role: input.newRole } }
    })
  }

  test('変更先ロールにOWNERを指定すると422エラーを投げる', async () => {
    await expect(membersService.updateRole(1, 10, 1, 'OWNER', { role: 'OWNER' })).rejects.toMatchObject({
      statusCode: 422,
      message: 'OWNERへの変更はできません',
    })
    expect(changeRole).not.toHaveBeenCalled()
  })

  test('MEMBERは操作できず403エラーを投げる', async () => {
    await expect(membersService.updateRole(1, 10, 1, 'MEMBER', { role: 'MEMBER' })).rejects.toMatchObject({ statusCode: 403 })
    expect(changeRole).not.toHaveBeenCalled()
  })

  test('OWNERロール指定のエラー（422）はMEMBERの権限不足（403）より先に返る', async () => {
    await expect(membersService.updateRole(1, 10, 1, 'MEMBER', { role: 'OWNER' })).rejects.toMatchObject({ statusCode: 422 })
  })

  test('組織ID・対象メンバーシップID・操作者ID・変更後ロールをrepositoryへ渡す', async () => {
    simulateRepository({ operatorRole: 'OWNER', targetRole: 'MEMBER' })

    await membersService.updateRole(1, 10, 5, 'OWNER', { role: 'ADMIN' })

    expect(changeRole).toHaveBeenCalledWith({ organizationId: 1, targetMembershipId: 10, actorUserId: 5, newRole: 'ADMIN' }, expect.any(Function))
  })

  test('OWNERはMEMBERをADMINに昇格できる', async () => {
    simulateRepository({ operatorRole: 'OWNER', targetRole: 'MEMBER' })

    const result = await membersService.updateRole(1, 10, 1, 'OWNER', { role: 'ADMIN' })

    expect(result.role).toBe('ADMIN')
  })

  test('OWNERはADMINをMEMBERに降格できる', async () => {
    simulateRepository({ operatorRole: 'OWNER', targetRole: 'ADMIN' })

    const result = await membersService.updateRole(1, 10, 1, 'OWNER', { role: 'MEMBER' })

    expect(result.role).toBe('MEMBER')
  })

  test('ADMINはMEMBERをMEMBERのまま指定でき、同一ロールならUNCHANGEDの結果をそのまま返す', async () => {
    simulateRepository({ operatorRole: 'ADMIN', targetRole: 'MEMBER' })

    const result = await membersService.updateRole(1, 10, 2, 'ADMIN', { role: 'MEMBER' })

    expect(result.role).toBe('MEMBER')
  })

  test('ロック後にADMINがADMINを操作しようとしていれば403エラーを投げる', async () => {
    simulateRepository({ operatorRole: 'ADMIN', targetRole: 'ADMIN' })

    await expect(membersService.updateRole(1, 10, 2, 'ADMIN', { role: 'MEMBER' })).rejects.toMatchObject({
      statusCode: 403,
      message: 'ADMINは他のADMINを操作できません',
    })
  })

  test('ロック後にADMINがMEMBERをADMINに昇格しようとしていれば403エラーを投げる', async () => {
    simulateRepository({ operatorRole: 'ADMIN', targetRole: 'MEMBER' })

    await expect(membersService.updateRole(1, 10, 2, 'ADMIN', { role: 'ADMIN' })).rejects.toMatchObject({
      statusCode: 403,
      message: 'ADMINはADMINへの昇格を実行できません',
    })
  })

  test('ロック後に対象がOWNERなら409エラーを投げる', async () => {
    simulateRepository({ operatorRole: 'OWNER', targetRole: 'OWNER' })

    await expect(membersService.updateRole(1, 10, 1, 'OWNER', { role: 'MEMBER' })).rejects.toMatchObject({
      statusCode: 409,
      message: 'OWNERのロールは変更できません',
    })
  })

  test('middlewareの時点ではADMINでも、ロック後に操作者がMEMBERへ降格していれば403エラーを投げる', async () => {
    simulateRepository({ operatorRole: 'MEMBER', targetRole: 'MEMBER' })

    await expect(membersService.updateRole(1, 10, 2, 'ADMIN', { role: 'MEMBER' })).rejects.toMatchObject({
      statusCode: 403,
      message: 'この操作には管理者以上の権限が必要です',
    })
  })

  test('ロック後の操作者がOWNERでなくなりADMINになっていれば、ADMINの規則で判定する', async () => {
    simulateRepository({ operatorRole: 'ADMIN', targetRole: 'ADMIN' })

    await expect(membersService.updateRole(1, 10, 1, 'OWNER', { role: 'MEMBER' })).rejects.toMatchObject({ statusCode: 403 })
  })

  test('操作者の所属または組織が消えていれば404エラー（組織が見つかりません）を投げる', async () => {
    changeRole.mockResolvedValue({ status: 'ORGANIZATION_NOT_FOUND' })

    await expect(membersService.updateRole(1, 10, 1, 'OWNER', { role: 'MEMBER' })).rejects.toMatchObject({
      statusCode: 404,
      message: '組織が見つかりません',
    })
  })

  test('対象が存在しない、または別組織なら404エラー（メンバーが見つかりません）を投げる', async () => {
    changeRole.mockResolvedValue({ status: 'TARGET_NOT_FOUND' })

    await expect(membersService.updateRole(1, 999, 1, 'OWNER', { role: 'MEMBER' })).rejects.toMatchObject({
      statusCode: 404,
      message: 'メンバーが見つかりません',
    })
  })

  test('条件付き更新の競合なら409エラーを投げる', async () => {
    changeRole.mockResolvedValue({ status: 'CONFLICT' })

    await expect(membersService.updateRole(1, 10, 1, 'OWNER', { role: 'ADMIN' })).rejects.toMatchObject({
      statusCode: 409,
      message: '競合によりロールを変更できませんでした',
    })
  })

  test('未知の結果は成功扱いにせずエラーを投げる', async () => {
    changeRole.mockResolvedValue({ status: 'UNKNOWN', membership })

    await expect(membersService.updateRole(1, 10, 1, 'OWNER', { role: 'ADMIN' })).rejects.toThrow('結果が不明')
  })

  test('repositoryのエラーはそのまま伝播する', async () => {
    changeRole.mockRejectedValue(new Error('INSERT失敗'))

    await expect(membersService.updateRole(1, 10, 1, 'OWNER', { role: 'ADMIN' })).rejects.toThrow('INSERT失敗')
  })
})

describe('membersService.remove', () => {
  type LockedState = { operatorRole: Role; targetRole: Role | null }

  beforeEach(() => {
    removeMember.mockReset()
  })

  /**
   * repositoryがロック後に読み直したロールで認可コールバックを呼ぶ動きを再現する。
   * 対象なしならTARGET_NOT_FOUND、拒否ならREJECTED、それ以外はREMOVEDを返す。
   */
  const simulateRepository = (locked: LockedState): void => {
    removeMember.mockImplementation(async (_input: unknown, authorize: (state: LockedState) => AppError | null) => {
      const rejection = authorize(locked)
      if (rejection !== null) {
        return { status: 'REJECTED', rejection }
      }
      if (locked.targetRole === null) {
        return { status: 'TARGET_NOT_FOUND' }
      }
      return { status: 'REMOVED' }
    })
  }

  test('操作者のユーザーIDをrepositoryへ渡す（middlewareのロールは使わない）', async () => {
    simulateRepository({ operatorRole: 'OWNER', targetRole: 'MEMBER' })

    await membersService.remove(1, 10, 5)

    expect(removeMember).toHaveBeenCalledWith({ organizationId: 1, targetMembershipId: 10, actorUserId: 5 }, expect.any(Function))
  })

  test.each([
    { name: 'OWNERはADMINを削除できる', operatorRole: 'OWNER', targetRole: 'ADMIN' },
    { name: 'OWNERはMEMBERを削除できる', operatorRole: 'OWNER', targetRole: 'MEMBER' },
    { name: 'ADMINはMEMBERを削除できる', operatorRole: 'ADMIN', targetRole: 'MEMBER' },
  ] as const)('$name', async ({ operatorRole, targetRole }) => {
    simulateRepository({ operatorRole, targetRole })

    await expect(membersService.remove(1, 10, 5)).resolves.toBeUndefined()
  })

  test.each([
    { name: 'ADMINがADMINを削除', locked: { operatorRole: 'ADMIN', targetRole: 'ADMIN' }, statusCode: 403, message: 'ADMINは他のADMINを削除' },
    { name: '対象がOWNER', locked: { operatorRole: 'OWNER', targetRole: 'OWNER' }, statusCode: 409, message: 'OWNERは削除' },
    { name: 'MEMBERが操作', locked: { operatorRole: 'MEMBER', targetRole: 'MEMBER' }, statusCode: 403, message: '管理者以上' },
    { name: 'MEMBERが存在しない対象を操作', locked: { operatorRole: 'MEMBER', targetRole: null }, statusCode: 403, message: '管理者以上' },
  ] as const)('$name: 認可コールバックが拒否し$statusCode', async ({ locked, statusCode, message }) => {
    simulateRepository(locked)

    await expect(membersService.remove(1, 10, 5)).rejects.toMatchObject({ statusCode, message: expect.stringContaining(message) })
  })

  test('対象が存在しなければ404エラーを投げる', async () => {
    simulateRepository({ operatorRole: 'OWNER', targetRole: null })

    await expect(membersService.remove(1, 999, 5)).rejects.toMatchObject({ statusCode: 404, message: 'メンバーが見つかりません' })
  })

  test('操作者の所属が確認できなければ404エラーを投げる', async () => {
    removeMember.mockResolvedValue({ status: 'ORGANIZATION_NOT_FOUND' })

    await expect(membersService.remove(1, 10, 5)).rejects.toMatchObject({ statusCode: 404, message: '組織が見つかりません' })
  })

  test('未知の結果は成功扱いせずエラーを投げる', async () => {
    removeMember.mockResolvedValue({ status: 'UNKNOWN' })

    await expect(membersService.remove(1, 10, 5)).rejects.toThrow('メンバー削除の結果が不明です')
  })

  test('監査ログの記録失敗はそのまま伝播する', async () => {
    removeMember.mockRejectedValue(new Error('INSERT失敗'))

    await expect(membersService.remove(1, 10, 5)).rejects.toThrow('INSERT失敗')
  })
})

describe('membersService.leave', () => {
  beforeEach(() => {
    leaveMember.mockReset()
  })

  test('repositoryがLEFTを返した場合は脱退を完了する', async () => {
    leaveMember.mockResolvedValue('LEFT')

    await membersService.leave(1, 2)

    expect(leaveMember).toHaveBeenCalledWith(1, 2)
  })

  test('最新状態がOWNERなら所有権移譲を求める409エラーになる', async () => {
    leaveMember.mockResolvedValue('OWNER')

    await expect(membersService.leave(1, 2)).rejects.toMatchObject({
      statusCode: 409,
      message: 'OWNERは組織から脱退できません。先に所有権を移譲してください',
    })
  })

  test('最新状態で未所属なら404エラーになる', async () => {
    leaveMember.mockResolvedValue('NOT_MEMBER')

    await expect(membersService.leave(1, 2)).rejects.toMatchObject({ statusCode: 404 })
  })

  test('再試行後も競合した場合は409エラーになる', async () => {
    leaveMember.mockResolvedValue('CONFLICT')

    await expect(membersService.leave(1, 2)).rejects.toMatchObject({ statusCode: 409 })
  })
})
