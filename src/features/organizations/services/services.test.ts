import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { Membership, Role } from '@/shared/membership/entities'
import type { Organization } from '@/shared/organization/entities'
import type { AppError } from '@/utils/errors'

import { encodeMemberListCursor } from '../mappers'

const createWithOwner = mock()
const findPageByUserId = mock()
const findById = mock()
const update = mock()
const deleteById = mock()

const findPageByOrganization = mock()
const membershipFindById = mock()
const membershipCreate = mock()
const membershipDeleteById = mock()
const findByUserAndOrganization = mock()

const findByEmail = mock()

const invitationFindPendingByOrgAndEmail = mock()
const invitationCreate = mock()
const invitationFindAllByOrganization = mock()
const invitationFindById = mock()
const invitationCancel = mock()

const transferOwnership = mock()
const leaveOrganization = mock()
const changeRoleWithAuditLog = mock()

await mock.module('@/features/organizations/repositories', () => ({
  organizationMembershipRepository: { leave: leaveOrganization },
  organizationOwnershipRepository: { transferOwnership },
  organizationMemberRoleRepository: { changeRoleWithAuditLog },
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
  ownershipTransferResults: {
    transferred: 'TRANSFERRED',
    targetNotFound: 'TARGET_NOT_FOUND',
    selfTransfer: 'SELF_TRANSFER',
    conflict: 'CONFLICT',
  },
}))

await mock.module('@/shared/organization/repositories', () => ({
  organizationRepository: { createWithOwner, findPageByUserId, findById, update, deleteById },
}))
await mock.module('@/shared/membership/repositories', () => ({
  membershipRepository: {
    findByUserAndOrganization,
    findPageByOrganization,
    findById: membershipFindById,
    create: membershipCreate,
    deleteById: membershipDeleteById,
  },
}))
await mock.module('@/shared/user/repositories', () => ({
  userRepository: { findByEmail },
}))
await mock.module('@/shared/invitation/repositories', () => ({
  invitationRepository: {
    findPendingByOrgAndEmail: invitationFindPendingByOrgAndEmail,
    create: invitationCreate,
    findAllByOrganization: invitationFindAllByOrganization,
    findById: invitationFindById,
    cancel: invitationCancel,
  },
}))

const { organizationsService } = await import('.')

const organization: Organization = {
  id: 1,
  name: 'Acme',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
}

describe('organizationsService.create', () => {
  beforeEach(() => {
    createWithOwner.mockReset()
  })

  test('組織を作成し、作成者をOWNERとして登録する', async () => {
    createWithOwner.mockResolvedValue(organization)

    const result = await organizationsService.create(1, { name: 'Acme' })

    expect(createWithOwner).toHaveBeenCalledWith('Acme', 1)
    expect(result.name).toBe('Acme')
  })
})

describe('organizationsService.listMine', () => {
  const organizations = (count: number): Organization[] => Array.from({ length: count }, (_, index) => ({ ...organization, id: index + 1 }))

  beforeEach(() => {
    findPageByUserId.mockReset()
  })

  test('次ページ判定のためlimit + 1件をrepositoryへ要求し、offsetをそのまま渡す', async () => {
    findPageByUserId.mockResolvedValue([])

    await organizationsService.listMine(1, 20, 40)

    expect(findPageByUserId).toHaveBeenCalledWith(1, 21, 40)
  })

  test('0件ならitemsは空でhasNextはfalseになる', async () => {
    findPageByUserId.mockResolvedValue([])

    const result = await organizationsService.listMine(1, 20, 0)

    expect(result).toEqual({ items: [], limit: 20, offset: 0, hasNext: false })
  })

  test('limit未満ならhasNextはfalseになる', async () => {
    findPageByUserId.mockResolvedValue(organizations(2))

    const result = await organizationsService.listMine(1, 3, 0)

    expect(result.items).toHaveLength(2)
    expect(result.hasNext).toBe(false)
  })

  test('limit件ちょうどならhasNextはfalseになる', async () => {
    findPageByUserId.mockResolvedValue(organizations(3))

    const result = await organizationsService.listMine(1, 3, 0)

    expect(result.items).toHaveLength(3)
    expect(result.hasNext).toBe(false)
  })

  test('limitを超えて取得できたらhasNextはtrueになり、itemsはlimit件に切り詰める', async () => {
    findPageByUserId.mockResolvedValue(organizations(4))

    const result = await organizationsService.listMine(1, 3, 0)

    expect(result.items.map((item) => item.id)).toEqual([1, 2, 3])
    expect(result).toMatchObject({ limit: 3, offset: 0, hasNext: true })
  })

  test('取得対象件数以上のoffsetならitemsは空でhasNextはfalseになる', async () => {
    findPageByUserId.mockResolvedValue([])

    const result = await organizationsService.listMine(1, 20, 10000)

    expect(result).toEqual({ items: [], limit: 20, offset: 10000, hasNext: false })
  })
})

describe('organizationsService.getById', () => {
  beforeEach(() => {
    findById.mockReset()
  })

  test('存在しない組織なら404エラーを投げる', async () => {
    findById.mockResolvedValue(null)

    await expect(organizationsService.getById(999)).rejects.toThrow('組織が見つかりません')
  })
})

describe('organizationsService.update', () => {
  beforeEach(() => {
    update.mockReset()
  })

  test('OWNERは更新できる', async () => {
    update.mockResolvedValue({ ...organization, name: 'New Name' })

    const result = await organizationsService.update(1, { name: 'New Name' }, 'OWNER')

    expect(result.name).toBe('New Name')
  })

  test('ADMINは更新できる', async () => {
    update.mockResolvedValue({ ...organization, name: 'New Name' })

    const result = await organizationsService.update(1, { name: 'New Name' }, 'ADMIN')

    expect(result.name).toBe('New Name')
  })

  test('MEMBERは更新できず403エラーを投げる', async () => {
    await expect(organizationsService.update(1, { name: 'New Name' }, 'MEMBER')).rejects.toThrow('管理者以上')
    expect(update).not.toHaveBeenCalled()
  })

  test('組織が存在しなければ404エラーを投げる', async () => {
    update.mockResolvedValue(null)

    await expect(organizationsService.update(999, { name: 'New Name' }, 'OWNER')).rejects.toThrow('組織が見つかりません')
  })
})

describe('organizationsService.remove', () => {
  beforeEach(() => {
    deleteById.mockReset()
  })

  test('OWNERは削除できる', async () => {
    deleteById.mockResolvedValue(true)

    await organizationsService.remove(1, 'OWNER')

    expect(deleteById).toHaveBeenCalledWith(1)
  })

  test('ADMINは削除できず403エラーを投げる', async () => {
    await expect(organizationsService.remove(1, 'ADMIN')).rejects.toThrow('オーナー')
    expect(deleteById).not.toHaveBeenCalled()
  })

  test('MEMBERは削除できず403エラーを投げる', async () => {
    await expect(organizationsService.remove(1, 'MEMBER')).rejects.toThrow('オーナー')
    expect(deleteById).not.toHaveBeenCalled()
  })

  test('組織が存在しなければ404エラーを投げる', async () => {
    deleteById.mockResolvedValue(false)

    await expect(organizationsService.remove(999, 'OWNER')).rejects.toThrow('組織が見つかりません')
  })
})

describe('organizationsService.transferOwnership', () => {
  beforeEach(() => {
    transferOwnership.mockReset()
  })

  test('OWNERは同じ組織のメンバーへ所有権を移譲できる', async () => {
    transferOwnership.mockResolvedValue('TRANSFERRED')

    await organizationsService.transferOwnership(1, 1, 'OWNER', 2)

    expect(transferOwnership).toHaveBeenCalledWith(1, 1, 2)
  })

  test('OWNER以外は403エラーになる', async () => {
    await expect(organizationsService.transferOwnership(1, 1, 'ADMIN', 2)).rejects.toMatchObject({ statusCode: 403 })

    expect(transferOwnership).not.toHaveBeenCalled()
  })

  test('移譲先が存在しないか別組織なら404エラーになる', async () => {
    transferOwnership.mockResolvedValue('TARGET_NOT_FOUND')

    await expect(organizationsService.transferOwnership(1, 1, 'OWNER', 999)).rejects.toMatchObject({ statusCode: 404 })
  })

  test('自分自身への移譲は422エラーになる', async () => {
    transferOwnership.mockResolvedValue('SELF_TRANSFER')

    await expect(organizationsService.transferOwnership(1, 1, 'OWNER', 1)).rejects.toMatchObject({ statusCode: 422 })
  })

  test('ロック待機後の再検証で競合した場合は409エラーになる', async () => {
    transferOwnership.mockResolvedValue('CONFLICT')

    await expect(organizationsService.transferOwnership(1, 1, 'OWNER', 2)).rejects.toMatchObject({ statusCode: 409 })
  })
})

describe('organizationsService.leave', () => {
  beforeEach(() => {
    leaveOrganization.mockReset()
  })

  test('repositoryがLEFTを返した場合は脱退を完了する', async () => {
    leaveOrganization.mockResolvedValue('LEFT')

    await organizationsService.leave(1, 2)

    expect(leaveOrganization).toHaveBeenCalledWith(1, 2)
  })

  test('最新状態がOWNERなら所有権移譲を求める409エラーになる', async () => {
    leaveOrganization.mockResolvedValue('OWNER')

    await expect(organizationsService.leave(1, 2)).rejects.toMatchObject({
      statusCode: 409,
      message: 'OWNERは組織から脱退できません。先に所有権を移譲してください',
    })
  })

  test('最新状態で未所属なら404エラーになる', async () => {
    leaveOrganization.mockResolvedValue('NOT_MEMBER')

    await expect(organizationsService.leave(1, 2)).rejects.toMatchObject({ statusCode: 404 })
  })

  test('再試行後も競合した場合は409エラーになる', async () => {
    leaveOrganization.mockResolvedValue('CONFLICT')

    await expect(organizationsService.leave(1, 2)).rejects.toMatchObject({ statusCode: 409 })
  })
})

const membership: Membership = {
  id: 10,
  userId: 2,
  organizationId: 1,
  role: 'MEMBER',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
}

describe('organizationsService.listMembers', () => {
  const memberships = (count: number): Membership[] =>
    Array.from({ length: count }, (_, index) => ({ ...membership, id: index + 1, createdAt: new Date(Date.UTC(2026, 0, index + 1)) }))

  beforeEach(() => {
    findPageByOrganization.mockReset()
  })

  test('cursorなしなら境界なしで、次ページ判定のためlimit + 1件をrepositoryへ要求する', async () => {
    findPageByOrganization.mockResolvedValue([])

    await organizationsService.listMembers(1, 20)

    expect(findPageByOrganization).toHaveBeenCalledWith(1, 21, null)
  })

  test('0件ならitemsは空でnextCursorはnullになる', async () => {
    findPageByOrganization.mockResolvedValue([])

    const result = await organizationsService.listMembers(1, 20)

    expect(result).toEqual({ items: [], nextCursor: null })
  })

  test('limit件ちょうどならnextCursorはnullになる', async () => {
    findPageByOrganization.mockResolvedValue(memberships(3))

    const result = await organizationsService.listMembers(1, 3)

    expect(result.items).toHaveLength(3)
    expect(result.nextCursor).toBeNull()
  })

  test('limitを超えて取得できたらitemsをlimit件に切り詰め、最後のitemの境界からnextCursorを作る', async () => {
    const rows = memberships(4)
    findPageByOrganization.mockResolvedValue(rows)

    const result = await organizationsService.listMembers(1, 3)

    expect(result.items.map((item) => item.id)).toEqual([1, 2, 3])
    expect(result.nextCursor).toBe(encodeMemberListCursor({ organizationId: 1, createdAt: rows[2]!.createdAt, id: 3 }))
  })

  test('cursor指定時はデコードした境界値をrepositoryへ渡す', async () => {
    findPageByOrganization.mockResolvedValue([])
    const createdAt = new Date('2026-01-03T00:00:00.000Z')
    const cursor = encodeMemberListCursor({ organizationId: 1, createdAt, id: 3 })

    await organizationsService.listMembers(1, 20, cursor)

    expect(findPageByOrganization).toHaveBeenCalledWith(1, 21, { createdAt, id: 3 })
  })

  test('形式が不正なcursorは400エラーになりrepositoryを呼ばない', async () => {
    await expect(organizationsService.listMembers(1, 20, 'invalid')).rejects.toMatchObject({ statusCode: 400 })

    expect(findPageByOrganization).not.toHaveBeenCalled()
  })

  test('別組織で発行されたcursorは400エラーになりrepositoryを呼ばない', async () => {
    const cursor = encodeMemberListCursor({ organizationId: 2, createdAt: new Date('2026-01-03T00:00:00.000Z'), id: 3 })

    await expect(organizationsService.listMembers(1, 20, cursor)).rejects.toMatchObject({ statusCode: 400 })

    expect(findPageByOrganization).not.toHaveBeenCalled()
  })
})

describe('organizationsService.addMember', () => {
  beforeEach(() => {
    findByEmail.mockReset()
    findByUserAndOrganization.mockReset()
    membershipCreate.mockReset()
  })

  test('OWNERはADMINを追加できる', async () => {
    findByEmail.mockResolvedValue({ id: 2, name: 'User', email: 'user@example.com', password: 'hash', createdAt: new Date(), updatedAt: new Date() })
    findByUserAndOrganization.mockResolvedValue(null)
    membershipCreate.mockResolvedValue({ ...membership, role: 'ADMIN' })

    const result = await organizationsService.addMember(1, 'OWNER', { email: 'user@example.com', role: 'ADMIN' })

    expect(result.role).toBe('ADMIN')
    expect(membershipCreate).toHaveBeenCalledWith(2, 1, 'ADMIN')
  })

  test('ADMINはMEMBERを追加できる', async () => {
    findByEmail.mockResolvedValue({ id: 2, name: 'User', email: 'user@example.com', password: 'hash', createdAt: new Date(), updatedAt: new Date() })
    findByUserAndOrganization.mockResolvedValue(null)
    membershipCreate.mockResolvedValue(membership)

    const result = await organizationsService.addMember(1, 'ADMIN', { email: 'user@example.com', role: 'MEMBER' })

    expect(result.role).toBe('MEMBER')
  })

  test('OWNERロール指定は422エラーを投げる', async () => {
    await expect(organizationsService.addMember(1, 'OWNER', { email: 'user@example.com', role: 'OWNER' })).rejects.toThrow('OWNERは追加できません')
    expect(membershipCreate).not.toHaveBeenCalled()
  })

  test('ADMINがADMINを追加しようとすると403エラーを投げる', async () => {
    await expect(organizationsService.addMember(1, 'ADMIN', { email: 'user@example.com', role: 'ADMIN' })).rejects.toThrow('ADMINはMEMBERのみ追加')
    expect(membershipCreate).not.toHaveBeenCalled()
  })

  test('MEMBERは操作できず403エラーを投げる', async () => {
    await expect(organizationsService.addMember(1, 'MEMBER', { email: 'user@example.com', role: 'MEMBER' })).rejects.toThrow('管理者以上')
    expect(membershipCreate).not.toHaveBeenCalled()
  })

  test('メールに一致するユーザーが存在しなければ404エラーを投げる', async () => {
    findByEmail.mockResolvedValue(null)

    await expect(organizationsService.addMember(1, 'OWNER', { email: 'notfound@example.com', role: 'MEMBER' })).rejects.toThrow('ユーザーが見つかりません')
    expect(membershipCreate).not.toHaveBeenCalled()
  })

  test('既にメンバーの場合は409エラーを投げる', async () => {
    findByEmail.mockResolvedValue({ id: 2, name: 'User', email: 'user@example.com', password: 'hash', createdAt: new Date(), updatedAt: new Date() })
    findByUserAndOrganization.mockResolvedValue(membership)

    await expect(organizationsService.addMember(1, 'OWNER', { email: 'user@example.com', role: 'MEMBER' })).rejects.toThrow('既にこの組織のメンバー')
    expect(membershipCreate).not.toHaveBeenCalled()
  })

  test('createがnullを返した場合（競合）は409エラーを投げる', async () => {
    findByEmail.mockResolvedValue({ id: 2, name: 'User', email: 'user@example.com', password: 'hash', createdAt: new Date(), updatedAt: new Date() })
    findByUserAndOrganization.mockResolvedValue(null)
    membershipCreate.mockResolvedValue(null)

    await expect(organizationsService.addMember(1, 'OWNER', { email: 'user@example.com', role: 'MEMBER' })).rejects.toThrow('既にこの組織のメンバー')
  })
})

describe('organizationsService.updateMemberRole', () => {
  type LockedState = { operatorRole: Role; targetRole: Role }

  beforeEach(() => {
    changeRoleWithAuditLog.mockReset()
  })

  /**
   * repositoryがロック後に読み直したロールで認可コールバックを呼ぶ動きを再現する。
   * 拒否ならREJECTED、同一ロールならUNCHANGED、それ以外はCHANGEDを返す。
   */
  const simulateRepository = (locked: LockedState): void => {
    changeRoleWithAuditLog.mockImplementation(async (input: { newRole: Role }, authorize: (state: LockedState) => AppError | null) => {
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
    await expect(organizationsService.updateMemberRole(1, 10, 1, 'OWNER', { role: 'OWNER' })).rejects.toMatchObject({
      statusCode: 422,
      message: 'OWNERへの変更はできません',
    })
    expect(changeRoleWithAuditLog).not.toHaveBeenCalled()
  })

  test('MEMBERは操作できず403エラーを投げる', async () => {
    await expect(organizationsService.updateMemberRole(1, 10, 1, 'MEMBER', { role: 'MEMBER' })).rejects.toMatchObject({ statusCode: 403 })
    expect(changeRoleWithAuditLog).not.toHaveBeenCalled()
  })

  test('OWNERロール指定のエラー（422）はMEMBERの権限不足（403）より先に返る', async () => {
    await expect(organizationsService.updateMemberRole(1, 10, 1, 'MEMBER', { role: 'OWNER' })).rejects.toMatchObject({ statusCode: 422 })
  })

  test('組織ID・対象メンバーシップID・操作者ID・変更後ロールをrepositoryへ渡す', async () => {
    simulateRepository({ operatorRole: 'OWNER', targetRole: 'MEMBER' })

    await organizationsService.updateMemberRole(1, 10, 5, 'OWNER', { role: 'ADMIN' })

    expect(changeRoleWithAuditLog).toHaveBeenCalledWith({ organizationId: 1, targetMembershipId: 10, actorUserId: 5, newRole: 'ADMIN' }, expect.any(Function))
  })

  test('OWNERはMEMBERをADMINに昇格できる', async () => {
    simulateRepository({ operatorRole: 'OWNER', targetRole: 'MEMBER' })

    const result = await organizationsService.updateMemberRole(1, 10, 1, 'OWNER', { role: 'ADMIN' })

    expect(result.role).toBe('ADMIN')
  })

  test('OWNERはADMINをMEMBERに降格できる', async () => {
    simulateRepository({ operatorRole: 'OWNER', targetRole: 'ADMIN' })

    const result = await organizationsService.updateMemberRole(1, 10, 1, 'OWNER', { role: 'MEMBER' })

    expect(result.role).toBe('MEMBER')
  })

  test('ADMINはMEMBERをMEMBERのまま指定でき、同一ロールならUNCHANGEDの結果をそのまま返す', async () => {
    simulateRepository({ operatorRole: 'ADMIN', targetRole: 'MEMBER' })

    const result = await organizationsService.updateMemberRole(1, 10, 2, 'ADMIN', { role: 'MEMBER' })

    expect(result.role).toBe('MEMBER')
  })

  test('ロック後にADMINがADMINを操作しようとしていれば403エラーを投げる', async () => {
    simulateRepository({ operatorRole: 'ADMIN', targetRole: 'ADMIN' })

    await expect(organizationsService.updateMemberRole(1, 10, 2, 'ADMIN', { role: 'MEMBER' })).rejects.toMatchObject({
      statusCode: 403,
      message: 'ADMINは他のADMINを操作できません',
    })
  })

  test('ロック後にADMINがMEMBERをADMINに昇格しようとしていれば403エラーを投げる', async () => {
    simulateRepository({ operatorRole: 'ADMIN', targetRole: 'MEMBER' })

    await expect(organizationsService.updateMemberRole(1, 10, 2, 'ADMIN', { role: 'ADMIN' })).rejects.toMatchObject({
      statusCode: 403,
      message: 'ADMINはADMINへの昇格を実行できません',
    })
  })

  test('ロック後に対象がOWNERなら409エラーを投げる', async () => {
    simulateRepository({ operatorRole: 'OWNER', targetRole: 'OWNER' })

    await expect(organizationsService.updateMemberRole(1, 10, 1, 'OWNER', { role: 'MEMBER' })).rejects.toMatchObject({
      statusCode: 409,
      message: 'OWNERのロールは変更できません',
    })
  })

  test('middlewareの時点ではADMINでも、ロック後に操作者がMEMBERへ降格していれば403エラーを投げる', async () => {
    simulateRepository({ operatorRole: 'MEMBER', targetRole: 'MEMBER' })

    await expect(organizationsService.updateMemberRole(1, 10, 2, 'ADMIN', { role: 'MEMBER' })).rejects.toMatchObject({
      statusCode: 403,
      message: 'この操作には管理者以上の権限が必要です',
    })
  })

  test('ロック後の操作者がOWNERでなくなりADMINになっていれば、ADMINの規則で判定する', async () => {
    simulateRepository({ operatorRole: 'ADMIN', targetRole: 'ADMIN' })

    await expect(organizationsService.updateMemberRole(1, 10, 1, 'OWNER', { role: 'MEMBER' })).rejects.toMatchObject({ statusCode: 403 })
  })

  test('操作者の所属または組織が消えていれば404エラー（組織が見つかりません）を投げる', async () => {
    changeRoleWithAuditLog.mockResolvedValue({ status: 'ORGANIZATION_NOT_FOUND' })

    await expect(organizationsService.updateMemberRole(1, 10, 1, 'OWNER', { role: 'MEMBER' })).rejects.toMatchObject({
      statusCode: 404,
      message: '組織が見つかりません',
    })
  })

  test('対象が存在しない、または別組織なら404エラー（メンバーが見つかりません）を投げる', async () => {
    changeRoleWithAuditLog.mockResolvedValue({ status: 'TARGET_NOT_FOUND' })

    await expect(organizationsService.updateMemberRole(1, 999, 1, 'OWNER', { role: 'MEMBER' })).rejects.toMatchObject({
      statusCode: 404,
      message: 'メンバーが見つかりません',
    })
  })

  test('条件付き更新の競合なら409エラーを投げる', async () => {
    changeRoleWithAuditLog.mockResolvedValue({ status: 'CONFLICT' })

    await expect(organizationsService.updateMemberRole(1, 10, 1, 'OWNER', { role: 'ADMIN' })).rejects.toMatchObject({
      statusCode: 409,
      message: '競合によりロールを変更できませんでした',
    })
  })

  test('未知の結果は成功扱いにせずエラーを投げる', async () => {
    changeRoleWithAuditLog.mockResolvedValue({ status: 'UNKNOWN', membership })

    await expect(organizationsService.updateMemberRole(1, 10, 1, 'OWNER', { role: 'ADMIN' })).rejects.toThrow('結果が不明')
  })

  test('repositoryのエラーはそのまま伝播する', async () => {
    changeRoleWithAuditLog.mockRejectedValue(new Error('INSERT失敗'))

    await expect(organizationsService.updateMemberRole(1, 10, 1, 'OWNER', { role: 'ADMIN' })).rejects.toThrow('INSERT失敗')
  })
})

describe('organizationsService.removeMember', () => {
  beforeEach(() => {
    membershipFindById.mockReset()
    membershipDeleteById.mockReset()
  })

  test('OWNERはADMINを削除できる', async () => {
    membershipFindById.mockResolvedValue({ ...membership, role: 'ADMIN' })
    membershipDeleteById.mockResolvedValue(true)

    await organizationsService.removeMember(1, 10, 'OWNER')

    expect(membershipDeleteById).toHaveBeenCalledWith(10)
  })

  test('OWNERはMEMBERを削除できる', async () => {
    membershipFindById.mockResolvedValue(membership)
    membershipDeleteById.mockResolvedValue(true)

    await organizationsService.removeMember(1, 10, 'OWNER')

    expect(membershipDeleteById).toHaveBeenCalledWith(10)
  })

  test('ADMINはMEMBERを削除できる', async () => {
    membershipFindById.mockResolvedValue(membership)
    membershipDeleteById.mockResolvedValue(true)

    await organizationsService.removeMember(1, 10, 'ADMIN')

    expect(membershipDeleteById).toHaveBeenCalledWith(10)
  })

  test('ADMINがADMINを削除しようとすると403エラーを投げる', async () => {
    membershipFindById.mockResolvedValue({ ...membership, role: 'ADMIN' })

    await expect(organizationsService.removeMember(1, 10, 'ADMIN')).rejects.toThrow('ADMINは他のADMINを削除')
    expect(membershipDeleteById).not.toHaveBeenCalled()
  })

  test('対象がOWNERなら409エラーを投げる', async () => {
    membershipFindById.mockResolvedValue({ ...membership, role: 'OWNER' })

    await expect(organizationsService.removeMember(1, 10, 'OWNER')).rejects.toThrow('OWNERは削除')
    expect(membershipDeleteById).not.toHaveBeenCalled()
  })

  test('MEMBERは操作できず403エラーを投げる', async () => {
    await expect(organizationsService.removeMember(1, 10, 'MEMBER')).rejects.toThrow('管理者以上')
    expect(membershipDeleteById).not.toHaveBeenCalled()
  })

  test('対象メンバーシップが存在しなければ404エラーを投げる', async () => {
    membershipFindById.mockResolvedValue(null)

    await expect(organizationsService.removeMember(1, 999, 'OWNER')).rejects.toThrow('メンバーが見つかりません')
    expect(membershipDeleteById).not.toHaveBeenCalled()
  })

  test('異なる組織のメンバーシップなら404エラーを投げる', async () => {
    membershipFindById.mockResolvedValue({ ...membership, organizationId: 99 })

    await expect(organizationsService.removeMember(1, 10, 'OWNER')).rejects.toThrow('メンバーが見つかりません')
    expect(membershipDeleteById).not.toHaveBeenCalled()
  })

  test('deleteById がfalseを返した場合は404エラーを投げる', async () => {
    membershipFindById.mockResolvedValue(membership)
    membershipDeleteById.mockResolvedValue(false)

    await expect(organizationsService.removeMember(1, 10, 'OWNER')).rejects.toThrow('メンバーが見つかりません')
  })
})

import type { Invitation } from '@/shared/invitation/entities'

const invitation: Invitation = {
  id: 20,
  organizationId: 1,
  email: 'invite@example.com',
  role: 'MEMBER',
  status: 'PENDING',
  token: 'uuid-token',
  expiresAt: new Date('2026-06-18T00:00:00.000Z'),
  createdAt: new Date('2026-06-11T00:00:00.000Z'),
}

describe('organizationsService.createInvitation', () => {
  beforeEach(() => {
    invitationFindPendingByOrgAndEmail.mockReset()
    invitationCreate.mockReset()
    findByEmail.mockReset()
    findByUserAndOrganization.mockReset()
  })

  test('OWNERはMEMBER招待を作成できる', async () => {
    invitationFindPendingByOrgAndEmail.mockResolvedValue(null)
    findByEmail.mockResolvedValue(null)
    invitationCreate.mockResolvedValue(invitation)

    const result = await organizationsService.createInvitation(1, 'OWNER', { email: 'invite@example.com', role: 'MEMBER' })

    expect(result.invitationToken).toBe('uuid-token')
    expect(invitationCreate).toHaveBeenCalledTimes(1)
  })

  test('OWNERはADMIN招待を作成できる', async () => {
    invitationFindPendingByOrgAndEmail.mockResolvedValue(null)
    findByEmail.mockResolvedValue(null)
    invitationCreate.mockResolvedValue({ ...invitation, role: 'ADMIN' })

    const result = await organizationsService.createInvitation(1, 'OWNER', { email: 'invite@example.com', role: 'ADMIN' })

    expect(result.role).toBe('ADMIN')
  })

  test('ADMINはMEMBER招待を作成できる', async () => {
    invitationFindPendingByOrgAndEmail.mockResolvedValue(null)
    findByEmail.mockResolvedValue(null)
    invitationCreate.mockResolvedValue(invitation)

    const result = await organizationsService.createInvitation(1, 'ADMIN', { email: 'invite@example.com', role: 'MEMBER' })

    expect(result.role).toBe('MEMBER')
  })

  test('MEMBERは操作できず403エラーを投げる', async () => {
    await expect(organizationsService.createInvitation(1, 'MEMBER', { email: 'invite@example.com', role: 'MEMBER' })).rejects.toThrow('管理者以上')
    expect(invitationCreate).not.toHaveBeenCalled()
  })

  test('OWNERロール指定は422エラーを投げる', async () => {
    await expect(organizationsService.createInvitation(1, 'OWNER', { email: 'invite@example.com', role: 'OWNER' })).rejects.toThrow('OWNERは招待できません')
    expect(invitationCreate).not.toHaveBeenCalled()
  })

  test('ADMINがADMIN招待を作成しようとすると403エラーを投げる', async () => {
    await expect(organizationsService.createInvitation(1, 'ADMIN', { email: 'invite@example.com', role: 'ADMIN' })).rejects.toThrow('ADMINはMEMBERのみ招待')
    expect(invitationCreate).not.toHaveBeenCalled()
  })

  test('PENDING招待が既に存在する場合は409エラーを投げる', async () => {
    invitationFindPendingByOrgAndEmail.mockResolvedValue(invitation)

    await expect(organizationsService.createInvitation(1, 'OWNER', { email: 'invite@example.com', role: 'MEMBER' })).rejects.toThrow('既に送信済み')
    expect(invitationCreate).not.toHaveBeenCalled()
  })

  test('対象メールが既にメンバーの場合は409エラーを投げる', async () => {
    invitationFindPendingByOrgAndEmail.mockResolvedValue(null)
    findByEmail.mockResolvedValue({ id: 2, name: 'User', email: 'invite@example.com', password: 'hash', createdAt: new Date(), updatedAt: new Date() })
    findByUserAndOrganization.mockResolvedValue(membership)

    await expect(organizationsService.createInvitation(1, 'OWNER', { email: 'invite@example.com', role: 'MEMBER' })).rejects.toThrow('既に組織のメンバー')
    expect(invitationCreate).not.toHaveBeenCalled()
  })

  test('ユーザーが存在しない場合でも招待を作成できる（新規ユーザー向け）', async () => {
    invitationFindPendingByOrgAndEmail.mockResolvedValue(null)
    findByEmail.mockResolvedValue(null)
    invitationCreate.mockResolvedValue(invitation)

    const result = await organizationsService.createInvitation(1, 'OWNER', { email: 'newuser@example.com', role: 'MEMBER' })

    expect(result.email).toBe('invite@example.com')
    expect(findByUserAndOrganization).not.toHaveBeenCalled()
  })

  test('createがnullを返した場合（DB制約による並行重複）は409エラーを投げる', async () => {
    invitationFindPendingByOrgAndEmail.mockResolvedValue(null)
    findByEmail.mockResolvedValue(null)
    invitationCreate.mockResolvedValue(null)

    await expect(organizationsService.createInvitation(1, 'OWNER', { email: 'invite@example.com', role: 'MEMBER' })).rejects.toThrow('既に送信済み')
  })
})

describe('organizationsService.listInvitations', () => {
  beforeEach(() => {
    invitationFindAllByOrganization.mockReset()
  })

  test('OWNER/ADMINは招待一覧を取得できる', async () => {
    invitationFindAllByOrganization.mockResolvedValue([invitation])

    const result = await organizationsService.listInvitations(1, 'OWNER')

    expect(result).toHaveLength(1)
    expect(result[0]?.invitationToken).toBe('uuid-token')
  })

  test('ADMINも招待一覧を取得できる', async () => {
    invitationFindAllByOrganization.mockResolvedValue([invitation])

    const result = await organizationsService.listInvitations(1, 'ADMIN')

    expect(result).toHaveLength(1)
  })

  test('MEMBERは取得できず403エラーを投げる', async () => {
    await expect(organizationsService.listInvitations(1, 'MEMBER')).rejects.toThrow('管理者以上')
    expect(invitationFindAllByOrganization).not.toHaveBeenCalled()
  })
})

describe('organizationsService.cancelInvitation', () => {
  beforeEach(() => {
    invitationFindById.mockReset()
    invitationCancel.mockReset()
  })

  test('OWNERはMEMBER宛て招待をキャンセルできる', async () => {
    invitationFindById.mockResolvedValue(invitation)
    invitationCancel.mockResolvedValue(true)

    await organizationsService.cancelInvitation(1, 20, 'OWNER')

    expect(invitationCancel).toHaveBeenCalledWith(20)
  })

  test('OWNERはADMIN宛て招待をキャンセルできる', async () => {
    invitationFindById.mockResolvedValue({ ...invitation, role: 'ADMIN' })
    invitationCancel.mockResolvedValue(true)

    await organizationsService.cancelInvitation(1, 20, 'OWNER')

    expect(invitationCancel).toHaveBeenCalledWith(20)
  })

  test('ADMINはMEMBER宛て招待をキャンセルできる', async () => {
    invitationFindById.mockResolvedValue(invitation)
    invitationCancel.mockResolvedValue(true)

    await organizationsService.cancelInvitation(1, 20, 'ADMIN')

    expect(invitationCancel).toHaveBeenCalledWith(20)
  })

  test('cancelがfalseを返した場合（並行更新による競合）は409エラーを投げる', async () => {
    invitationFindById.mockResolvedValue(invitation)
    invitationCancel.mockResolvedValue(false)

    await expect(organizationsService.cancelInvitation(1, 20, 'OWNER')).rejects.toThrow('PENDING状態の招待のみ')
  })

  test('ADMINがADMIN宛て招待をキャンセルしようとすると403エラーを投げる', async () => {
    invitationFindById.mockResolvedValue({ ...invitation, role: 'ADMIN' })

    await expect(organizationsService.cancelInvitation(1, 20, 'ADMIN')).rejects.toThrow('ADMINはADMIN宛て')
    expect(invitationCancel).not.toHaveBeenCalled()
  })

  test('MEMBERは操作できず403エラーを投げる', async () => {
    await expect(organizationsService.cancelInvitation(1, 20, 'MEMBER')).rejects.toThrow('管理者以上')
    expect(invitationCancel).not.toHaveBeenCalled()
  })

  test('招待が存在しなければ404エラーを投げる', async () => {
    invitationFindById.mockResolvedValue(null)

    await expect(organizationsService.cancelInvitation(1, 999, 'OWNER')).rejects.toThrow('招待が見つかりません')
    expect(invitationCancel).not.toHaveBeenCalled()
  })

  test('異なる組織の招待なら404エラーを投げる', async () => {
    invitationFindById.mockResolvedValue({ ...invitation, organizationId: 99 })

    await expect(organizationsService.cancelInvitation(1, 20, 'OWNER')).rejects.toThrow('招待が見つかりません')
    expect(invitationCancel).not.toHaveBeenCalled()
  })

  test('PENDING以外の招待はキャンセルできず409エラーを投げる', async () => {
    invitationFindById.mockResolvedValue({ ...invitation, status: 'ACCEPTED' })

    await expect(organizationsService.cancelInvitation(1, 20, 'OWNER')).rejects.toThrow('PENDING状態の招待のみ')
    expect(invitationCancel).not.toHaveBeenCalled()
  })
})
