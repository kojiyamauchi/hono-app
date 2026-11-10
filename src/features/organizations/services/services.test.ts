import { beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'

import type { Membership, Role } from '@/shared/membership/entities'
import type { Organization } from '@/shared/organization/entities'
import type { AppError } from '@/utils/errors'

import type { AuditLog } from '../entities'
import { encodeAuditLogCursor, encodeMemberListCursor } from '../mappers'

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
const getInvitationEmailConfig = mock()
const requestResend = mock()

const transferOwnership = mock()
const leaveOrganization = mock()
const changeRoleWithAuditLog = mock()
const findAuditLogPage = mock()
const removeWithAuditLog = mock()

await mock.module('@/features/organizations/repositories', () => ({
  organizationMemberRemovalRepository: { removeWithAuditLog },
  memberRemovalResults: {
    removed: 'REMOVED',
    organizationNotFound: 'ORGANIZATION_NOT_FOUND',
    targetNotFound: 'TARGET_NOT_FOUND',
    rejected: 'REJECTED',
  },
  organizationMembershipRepository: { leave: leaveOrganization },
  organizationOwnershipRepository: { transferOwnership },
  organizationMemberRoleRepository: { changeRoleWithAuditLog },
  organizationAuditLogRepository: { findPageByOrganization: findAuditLogPage },
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
await mock.module('@/shared/invitation/services/emailConfig', () => ({ getInvitationEmailConfig }))
await mock.module('@/shared/invitation/repositories/emailResend', () => ({
  invitationEmailResendRepository: { requestResend },
  invitationEmailResendResults: { requested: 'REQUESTED', organizationNotFound: 'ORGANIZATION_NOT_FOUND', rejected: 'REJECTED' },
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

describe('organizationsService.listAuditLogs', () => {
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

    await organizationsService.listAuditLogs(1, 20)

    expect(findAuditLogPage).toHaveBeenCalledWith(1, 21, null)
  })

  test('0件ならitemsは空でnextCursorはnullになる', async () => {
    findAuditLogPage.mockResolvedValue([])

    const result = await organizationsService.listAuditLogs(1, 20)

    expect(result).toEqual({ items: [], nextCursor: null })
  })

  test('limit件ちょうど（最終ページ）ならnextCursorはnullになる', async () => {
    findAuditLogPage.mockResolvedValue(auditLogs(3))

    const result = await organizationsService.listAuditLogs(1, 3)

    expect(result.items).toHaveLength(3)
    expect(result.nextCursor).toBeNull()
  })

  test('limitを超えて取得できたらitemsをlimit件に切り詰め、最後のitemの境界からnextCursorを作る', async () => {
    const rows = auditLogs(4)
    findAuditLogPage.mockResolvedValue(rows)

    const result = await organizationsService.listAuditLogs(1, 3)

    expect(result.items.map((item) => item.id)).toEqual([4, 3, 2])
    expect(result.items[0]?.createdAt).toBe(rows[0]!.createdAt.toISOString())
    expect(result.nextCursor).toBe(encodeAuditLogCursor({ organizationId: 1, createdAt: rows[2]!.createdAt, id: 2 }))
  })

  test('cursor指定時はデコードした境界値をrepositoryへ渡す', async () => {
    findAuditLogPage.mockResolvedValue([])
    const createdAt = new Date('2026-01-03T00:00:00.000Z')
    const cursor = encodeAuditLogCursor({ organizationId: 1, createdAt, id: 3 })

    await organizationsService.listAuditLogs(1, 20, cursor)

    expect(findAuditLogPage).toHaveBeenCalledWith(1, 21, { createdAt, id: 3 })
  })

  test('形式が不正なcursorは400エラーになりrepositoryを呼ばない', async () => {
    await expect(organizationsService.listAuditLogs(1, 20, 'invalid')).rejects.toMatchObject({ statusCode: 400, message: 'カーソルが不正です' })

    expect(findAuditLogPage).not.toHaveBeenCalled()
  })

  test('別組織で発行されたcursorは400エラーになりrepositoryを呼ばない', async () => {
    const cursor = encodeAuditLogCursor({ organizationId: 2, createdAt: new Date('2026-01-03T00:00:00.000Z'), id: 3 })

    await expect(organizationsService.listAuditLogs(1, 20, cursor)).rejects.toMatchObject({ statusCode: 400 })

    expect(findAuditLogPage).not.toHaveBeenCalled()
  })

  test('メンバー一覧のcursor（kindなし）は同じ組織でも400エラーになりrepositoryを呼ばない', async () => {
    const cursor = encodeMemberListCursor({ organizationId: 1, createdAt: new Date('2026-01-03T00:00:00.000Z'), id: 3 })

    await expect(organizationsService.listAuditLogs(1, 20, cursor)).rejects.toMatchObject({ statusCode: 400 })

    expect(findAuditLogPage).not.toHaveBeenCalled()
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
  type LockedState = { operatorRole: Role; targetRole: Role | null }

  beforeEach(() => {
    removeWithAuditLog.mockReset()
  })

  /**
   * repositoryがロック後に読み直したロールで認可コールバックを呼ぶ動きを再現する。
   * 対象なしならTARGET_NOT_FOUND、拒否ならREJECTED、それ以外はREMOVEDを返す。
   */
  const simulateRepository = (locked: LockedState): void => {
    removeWithAuditLog.mockImplementation(async (_input: unknown, authorize: (state: LockedState) => AppError | null) => {
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

    await organizationsService.removeMember(1, 10, 5)

    expect(removeWithAuditLog).toHaveBeenCalledWith({ organizationId: 1, targetMembershipId: 10, actorUserId: 5 }, expect.any(Function))
  })

  test.each([
    { name: 'OWNERはADMINを削除できる', operatorRole: 'OWNER', targetRole: 'ADMIN' },
    { name: 'OWNERはMEMBERを削除できる', operatorRole: 'OWNER', targetRole: 'MEMBER' },
    { name: 'ADMINはMEMBERを削除できる', operatorRole: 'ADMIN', targetRole: 'MEMBER' },
  ] as const)('$name', async ({ operatorRole, targetRole }) => {
    simulateRepository({ operatorRole, targetRole })

    await expect(organizationsService.removeMember(1, 10, 5)).resolves.toBeUndefined()
  })

  test.each([
    { name: 'ADMINがADMINを削除', locked: { operatorRole: 'ADMIN', targetRole: 'ADMIN' }, statusCode: 403, message: 'ADMINは他のADMINを削除' },
    { name: '対象がOWNER', locked: { operatorRole: 'OWNER', targetRole: 'OWNER' }, statusCode: 409, message: 'OWNERは削除' },
    { name: 'MEMBERが操作', locked: { operatorRole: 'MEMBER', targetRole: 'MEMBER' }, statusCode: 403, message: '管理者以上' },
    { name: 'MEMBERが存在しない対象を操作', locked: { operatorRole: 'MEMBER', targetRole: null }, statusCode: 403, message: '管理者以上' },
  ] as const)('$name: 認可コールバックが拒否し$statusCode', async ({ locked, statusCode, message }) => {
    simulateRepository(locked)

    await expect(organizationsService.removeMember(1, 10, 5)).rejects.toMatchObject({ statusCode, message: expect.stringContaining(message) })
  })

  test('対象が存在しなければ404エラーを投げる', async () => {
    simulateRepository({ operatorRole: 'OWNER', targetRole: null })

    await expect(organizationsService.removeMember(1, 999, 5)).rejects.toMatchObject({ statusCode: 404, message: 'メンバーが見つかりません' })
  })

  test('操作者の所属が確認できなければ404エラーを投げる', async () => {
    removeWithAuditLog.mockResolvedValue({ status: 'ORGANIZATION_NOT_FOUND' })

    await expect(organizationsService.removeMember(1, 10, 5)).rejects.toMatchObject({ statusCode: 404, message: '組織が見つかりません' })
  })

  test('未知の結果は成功扱いせずエラーを投げる', async () => {
    removeWithAuditLog.mockResolvedValue({ status: 'UNKNOWN' })

    await expect(organizationsService.removeMember(1, 10, 5)).rejects.toThrow('メンバー削除の結果が不明です')
  })

  test('監査ログの記録失敗はそのまま伝播する', async () => {
    removeWithAuditLog.mockRejectedValue(new Error('INSERT失敗'))

    await expect(organizationsService.removeMember(1, 10, 5)).rejects.toThrow('INSERT失敗')
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
    getInvitationEmailConfig.mockReset()
    findByEmail.mockReset()
    findByUserAndOrganization.mockReset()
  })

  test('OWNERはMEMBER招待を作成できる', async () => {
    invitationFindPendingByOrgAndEmail.mockResolvedValue(null)
    findByEmail.mockResolvedValue(null)
    invitationCreate.mockResolvedValue(invitation)

    const result = await organizationsService.createInvitation(1, 'OWNER', { email: 'invite@example.com', role: 'MEMBER' })

    expect(result.invitationToken).toBe('uuid-token')
    expect(invitationCreate).toHaveBeenCalledWith(1, 'invite@example.com', 'MEMBER', expect.any(String), expect.any(Date), undefined)
  })

  test('配信有効時は作成時の送信設定をrepositoryに渡す', async () => {
    const delivery = { fromEmail: 'sender@example.com', scalarUrl: 'https://example.com/open-api/scalar', templateVersion: 1 }
    getInvitationEmailConfig.mockReturnValue(delivery)
    invitationFindPendingByOrgAndEmail.mockResolvedValue(null)
    findByEmail.mockResolvedValue(null)
    invitationCreate.mockResolvedValue(invitation)

    await organizationsService.createInvitation(1, 'OWNER', { email: 'invite@example.com', role: 'MEMBER' })

    expect(invitationCreate).toHaveBeenCalledWith(1, 'invite@example.com', 'MEMBER', expect.any(String), expect.any(Date), delivery)
  })

  test('配信待ちの保存失敗は機密情報をログに出さず500を返す', async () => {
    getInvitationEmailConfig.mockReturnValue({ fromEmail: 'sender@example.com', scalarUrl: 'https://example.com/open-api/scalar', templateVersion: 1 })
    invitationFindPendingByOrgAndEmail.mockResolvedValue(null)
    findByEmail.mockResolvedValue(null)
    invitationCreate.mockRejectedValue(new Error('invite@example.com private-token'))
    const log = spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await expect(organizationsService.createInvitation(1, 'OWNER', { email: 'invite@example.com', role: 'MEMBER' })).rejects.toMatchObject({
        statusCode: 500,
        message: 'サーバーエラーが発生しました',
      })
      expect(log).toHaveBeenCalledTimes(1)
      expect(log).toHaveBeenCalledWith('招待と配信待ちの保存に失敗しました', { organizationId: 1 })
    } finally {
      log.mockRestore()
    }
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

    await expect(organizationsService.createInvitation(1, 'OWNER', { email: 'invite@example.com', role: 'MEMBER' })).rejects.toThrow('既に作成済み')
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

    await expect(organizationsService.createInvitation(1, 'OWNER', { email: 'invite@example.com', role: 'MEMBER' })).rejects.toThrow('既に作成済み')
  })
})

describe('organizationsService.listInvitations', () => {
  beforeEach(() => {
    invitationFindAllByOrganization.mockReset()
  })

  test('OWNER/ADMINは招待一覧を取得できる', async () => {
    invitationFindAllByOrganization.mockResolvedValue([{ ...invitation, emailDelivery: null }])

    const result = await organizationsService.listInvitations(1, 'OWNER')

    expect(result).toHaveLength(1)
    expect(result[0]?.invitationToken).toBe('uuid-token')
    expect(result[0]?.emailDeliveryStatus).toBeNull()
  })

  test('ADMINも招待一覧を取得できる', async () => {
    invitationFindAllByOrganization.mockResolvedValue([{ ...invitation, emailDelivery: null }])

    const result = await organizationsService.listInvitations(1, 'ADMIN')

    expect(result).toHaveLength(1)
  })

  test('MEMBERは取得できず403エラーを投げる', async () => {
    await expect(organizationsService.listInvitations(1, 'MEMBER')).rejects.toThrow('管理者以上')
    expect(invitationFindAllByOrganization).not.toHaveBeenCalled()
  })

  test('保存済みの配信状態5種類と配信記録なし(null)をそのままemailDeliveryStatusへ写す', async () => {
    const statuses = ['PENDING', 'ACCEPTED', 'REJECTED', 'UNKNOWN', 'SKIPPED'] as const
    invitationFindAllByOrganization.mockResolvedValue([
      ...statuses.map((status, index) => ({ ...invitation, id: index + 1, emailDelivery: { status } })),
      { ...invitation, id: 99, emailDelivery: null },
    ])

    const result = await organizationsService.listInvitations(1, 'OWNER')

    expect(result.map((item) => item.emailDeliveryStatus)).toEqual([...statuses, null])
    expect(invitationFindAllByOrganization).toHaveBeenCalledWith(1)
  })

  test('配信設定や期限切れに関わらず、保存されたPENDINGを上書きせず返し、設定を参照しない', async () => {
    getInvitationEmailConfig.mockReset()
    const expired = { ...invitation, expiresAt: new Date('2000-01-01T00:00:00.000Z'), emailDelivery: { status: 'PENDING' } }
    invitationFindAllByOrganization.mockResolvedValue([expired])

    const result = await organizationsService.listInvitations(1, 'ADMIN')

    expect(result[0]?.status).toBe('PENDING')
    expect(result[0]?.emailDeliveryStatus).toBe('PENDING')
    expect(getInvitationEmailConfig).not.toHaveBeenCalled()
  })

  test('配信レコードの内部情報を含めない', async () => {
    invitationFindAllByOrganization.mockResolvedValue([
      { ...invitation, emailDelivery: { status: 'ACCEPTED', resendEmailId: 'resend-secret', lastError: 'err' } },
    ])

    const result = await organizationsService.listInvitations(1, 'OWNER')

    expect(JSON.stringify(result)).not.toContain('resend-secret')
    expect(Object.keys(result[0] ?? {})).toContain('emailDeliveryStatus')
    expect(Object.keys(result[0] ?? {})).not.toContain('emailDelivery')
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

describe('organizationsService.resendInvitationEmail', () => {
  const now = new Date('2026-01-01T00:00:00.000Z')
  const snapshot = { fromEmail: 'noreply@example.com', scalarUrl: 'https://example.com/open-api/scalar', templateVersion: 1 }
  const eligibleDelivery = { status: 'REJECTED', hasUnknownOutcome: false, lastError: 'client', manualResendRequestedAt: null }
  const baseState = {
    operatorRole: 'OWNER',
    invitation: { role: 'MEMBER', status: 'PENDING', expiresAt: new Date('2026-01-08T00:00:00.000Z') },
    delivery: eligibleDelivery,
    now,
  }

  type Callbacks = Record<'authorizeOperator' | 'authorizeTarget' | 'evaluate', (s: unknown) => unknown>

  /** repositoryがロック後の状態で段階ごとにコールバックを呼び、拒否で止まる動きを再現する。 */
  const mockLockedState = (state: Record<string, unknown>): void => {
    requestResend.mockImplementation(async (_input: unknown, callbacks: Callbacks) => {
      const locked = { ...baseState, ...state } as typeof baseState & { invitation: typeof baseState.invitation | null }
      const rejected = (rejection: unknown): { status: string; rejection: unknown } => ({ status: 'REJECTED', rejection })
      const operator = callbacks.authorizeOperator({ operatorRole: locked.operatorRole })
      if (operator !== null) return rejected(operator)
      const target = callbacks.authorizeTarget({ operatorRole: locked.operatorRole, invitation: locked.invitation })
      if (target !== null) return rejected(target)
      const evaluation = callbacks.evaluate({ invitation: locked.invitation, delivery: locked.delivery, now: locked.now })
      return evaluation === null ? { status: 'REQUESTED' } : rejected(evaluation)
    })
  }

  /** 操作者のロールはmiddlewareの値ではなく、ロック後の状態（mockLockedState）から決まる。 */
  const run = (): Promise<void> => organizationsService.resendInvitationEmail(1, 20, 5)

  beforeEach(() => {
    requestResend.mockReset()
    getInvitationEmailConfig.mockReset()
    getInvitationEmailConfig.mockReturnValue(snapshot)
    mockLockedState({})
  })

  test('OWNERの依頼を受け付け、操作者・招待と送信設定をrepositoryへ渡す', async () => {
    await run()

    expect(requestResend.mock.calls[0]?.[0]).toEqual({ organizationId: 1, invitationId: 20, actorUserId: 5, snapshot })
  })

  test('ADMINはMEMBER宛てを受け付けられる', async () => {
    mockLockedState({ operatorRole: 'ADMIN' })

    await run()

    expect(requestResend).toHaveBeenCalledTimes(1)
  })

  test('OWNERはADMIN宛てを受け付けられる', async () => {
    mockLockedState({ invitation: { ...baseState.invitation, role: 'ADMIN' } })

    await run()

    expect(requestResend).toHaveBeenCalledTimes(1)
  })

  test('ADMINがADMIN宛てを再送しようとすると403', async () => {
    mockLockedState({ operatorRole: 'ADMIN', invitation: { ...baseState.invitation, role: 'ADMIN' } })

    await expect(run()).rejects.toMatchObject({ statusCode: 403 })
  })

  test.each(['OWNER', 'ADMIN'])('%sでもOWNER宛ての招待（DBに行があっても）は403で保存しない', async (operatorRole) => {
    mockLockedState({ operatorRole, invitation: { ...baseState.invitation, role: 'OWNER' } })

    await expect(run()).rejects.toMatchObject({ statusCode: 403 })
  })

  test('ロール判定は引数のロールではなくロック後のDB上のロールで行い、MEMBERなら招待を見ずに403', async () => {
    mockLockedState({ operatorRole: 'MEMBER', invitation: null })

    await expect(run()).rejects.toMatchObject({ statusCode: 403, message: 'この操作には管理者以上の権限が必要です' })
  })

  test('ロック後に昇格していれば、昇格後のロールで受け付けられる', async () => {
    mockLockedState({ operatorRole: 'ADMIN' })

    await run()

    expect(requestResend).toHaveBeenCalledTimes(1)
  })

  test('operatorRoleを引数に取らず、repositoryへ操作者のロールを渡さない', async () => {
    await run()

    expect(organizationsService.resendInvitationEmail.length).toBe(3)
    expect(requestResend.mock.calls[0]?.[0]).not.toHaveProperty('operatorRole')
  })

  test('招待が存在しなければ404', async () => {
    mockLockedState({ invitation: null, delivery: null })

    await expect(run()).rejects.toMatchObject({ statusCode: 404, message: '招待が見つかりません' })
  })

  test('組織または所属がなければ404', async () => {
    requestResend.mockResolvedValue({ status: 'ORGANIZATION_NOT_FOUND' })

    await expect(run()).rejects.toMatchObject({ statusCode: 404, message: '組織が見つかりません' })
  })

  test('再送受付済みは専用メッセージの409で、設定無効・期限切れ・非PENDINGより優先する', async () => {
    getInvitationEmailConfig.mockReturnValue(undefined)
    mockLockedState({
      invitation: { ...baseState.invitation, status: 'CANCELED', expiresAt: new Date('2025-12-31T00:00:00.000Z') },
      delivery: { ...eligibleDelivery, manualResendRequestedAt: now },
    })

    await expect(run()).rejects.toMatchObject({ statusCode: 409, message: 'この招待メールの再送は既に受け付けています' })
  })

  test('再送受付済みは設定不備の500より優先する', async () => {
    getInvitationEmailConfig.mockImplementation(() => {
      throw new Error('invalid')
    })
    mockLockedState({ delivery: { ...eligibleDelivery, manualResendRequestedAt: now } })

    await expect(run()).rejects.toMatchObject({ statusCode: 409, message: 'この招待メールの再送は既に受け付けています' })
  })

  test('対象ロールの認可は再送受付済みより優先する', async () => {
    mockLockedState({
      operatorRole: 'ADMIN',
      invitation: { ...baseState.invitation, role: 'ADMIN' },
      delivery: { ...eligibleDelivery, manualResendRequestedAt: now },
    })

    await expect(run()).rejects.toMatchObject({ statusCode: 403 })
  })

  test('配信設定が無効なら409', async () => {
    getInvitationEmailConfig.mockReturnValue(undefined)

    await expect(run()).rejects.toMatchObject({ statusCode: 409, message: '招待メールの配信が有効ではありません' })
  })

  test('配信設定の不備は500でトークン等を含まないメッセージを返す', async () => {
    getInvitationEmailConfig.mockImplementation(() => {
      throw new Error('RESEND_API_KEYが必要です')
    })
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})

    await expect(run()).rejects.toMatchObject({ statusCode: 500, message: 'サーバーエラーが発生しました' })
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('RESEND_API_KEY')
    errorSpy.mockRestore()
  })

  test('設定不備でも招待が存在しなければ404を優先する', async () => {
    getInvitationEmailConfig.mockImplementation(() => {
      throw new Error('invalid')
    })
    mockLockedState({ invitation: null, delivery: null })

    await expect(run()).rejects.toMatchObject({ statusCode: 404 })
  })

  test.each(['ACCEPTED', 'EXPIRED', 'CANCELED', 'DECLINED'])('招待が%sなら409', async (status) => {
    mockLockedState({ invitation: { ...baseState.invitation, status } })

    await expect(run()).rejects.toMatchObject({ statusCode: 409, message: 'PENDING状態の招待のみメールを再送できます' })
  })

  test('期限と判定時刻が等しい場合も期限切れとして409', async () => {
    mockLockedState({ invitation: { ...baseState.invitation, expiresAt: now } })

    await expect(run()).rejects.toMatchObject({ statusCode: 409, message: '招待の有効期限が切れています' })
  })

  test('期限の1ms前は受け付ける', async () => {
    mockLockedState({ invitation: { ...baseState.invitation, expiresAt: new Date(now.getTime() + 1) } })

    await run()

    expect(requestResend).toHaveBeenCalledTimes(1)
  })

  test.each([
    ['配信行なし', null],
    ['PENDING', { ...eligibleDelivery, status: 'PENDING' }],
    ['ACCEPTED', { ...eligibleDelivery, status: 'ACCEPTED' }],
    ['受付結果不明', { ...eligibleDelivery, hasUnknownOutcome: true }],
    ['invalid_idempotency', { ...eligibleDelivery, lastError: 'invalid_idempotency' }],
    ['分類なし', { ...eligibleDelivery, lastError: null }],
  ])('再送対象外（%s）なら内部情報を含まない409', async (_name, delivery) => {
    mockLockedState({ delivery })

    const error = await run().catch((e: unknown) => e as AppError)

    expect(error).toMatchObject({ statusCode: 409, message: 'この招待メールは再送できません' })
  })

  test('rate_limitedも再送対象', async () => {
    mockLockedState({ delivery: { ...eligibleDelivery, lastError: 'rate_limited' } })

    await run()

    expect(requestResend).toHaveBeenCalledTimes(1)
  })

  test('repositoryの予期しない失敗は内部情報を含まない500にする', async () => {
    requestResend.mockRejectedValue(new Error('db secret failure'))
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})

    await expect(run()).rejects.toMatchObject({ statusCode: 500, message: 'サーバーエラーが発生しました' })
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('secret')
    errorSpy.mockRestore()
  })

  test('未知のrepository結果を成功として扱わない', async () => {
    requestResend.mockResolvedValue({ status: 'UNKNOWN' })

    await expect(run()).rejects.toThrow('結果が不明です')
  })
})
