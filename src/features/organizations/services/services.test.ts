import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { Membership } from '@/shared/membership/entities'
import type { Organization } from '@/shared/organization/entities'

const createWithOwner = mock()
const findByUserId = mock()
const findById = mock()
const update = mock()
const deleteById = mock()

const findAllByOrganization = mock()
const membershipFindById = mock()
const membershipCreate = mock()
const updateRole = mock()
const membershipDeleteById = mock()
const findByUserAndOrganization = mock()

const findByEmail = mock()

const invitationFindPendingByOrgAndEmail = mock()
const invitationCreate = mock()
const invitationFindAllByOrganization = mock()
const invitationFindById = mock()
const invitationCancel = mock()

await mock.module('@/shared/organization/repositories', () => ({
  organizationRepository: { createWithOwner, findByUserId, findById, update, deleteById },
}))
await mock.module('@/shared/membership/repositories', () => ({
  membershipRepository: {
    findByUserAndOrganization,
    findAllByOrganization,
    findById: membershipFindById,
    create: membershipCreate,
    updateRole,
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
  beforeEach(() => {
    findByUserId.mockReset()
  })

  test('所属する組織の一覧を返す', async () => {
    findByUserId.mockResolvedValue([organization])

    const result = await organizationsService.listMine(1)

    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe('Acme')
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

const membership: Membership = {
  id: 10,
  userId: 2,
  organizationId: 1,
  role: 'MEMBER',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
}

describe('organizationsService.listMembers', () => {
  beforeEach(() => {
    findAllByOrganization.mockReset()
  })

  test('組織のメンバー一覧を返す', async () => {
    findAllByOrganization.mockResolvedValue([membership])

    const result = await organizationsService.listMembers(1)

    expect(result).toHaveLength(1)
    expect(result[0]?.role).toBe('MEMBER')
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
  beforeEach(() => {
    membershipFindById.mockReset()
    updateRole.mockReset()
  })

  test('変更先ロールにOWNERを指定すると422エラーを投げる', async () => {
    await expect(organizationsService.updateMemberRole(1, 10, 'OWNER', { role: 'OWNER' })).rejects.toThrow('OWNERへの変更はできません')
    expect(updateRole).not.toHaveBeenCalled()
  })

  test('OWNERはMEMBERをADMINに昇格できる', async () => {
    membershipFindById.mockResolvedValue(membership)
    updateRole.mockResolvedValue({ ...membership, role: 'ADMIN' })

    const result = await organizationsService.updateMemberRole(1, 10, 'OWNER', { role: 'ADMIN' })

    expect(result.role).toBe('ADMIN')
  })

  test('OWNERはADMINをMEMBERに降格できる', async () => {
    membershipFindById.mockResolvedValue({ ...membership, role: 'ADMIN' })
    updateRole.mockResolvedValue(membership)

    const result = await organizationsService.updateMemberRole(1, 10, 'OWNER', { role: 'MEMBER' })

    expect(result.role).toBe('MEMBER')
  })

  test('ADMINはMEMBERのロールをMEMBERのままにできる', async () => {
    membershipFindById.mockResolvedValue(membership)
    updateRole.mockResolvedValue(membership)

    const result = await organizationsService.updateMemberRole(1, 10, 'ADMIN', { role: 'MEMBER' })

    expect(result.role).toBe('MEMBER')
  })

  test('ADMINがADMINを操作しようとすると403エラーを投げる', async () => {
    membershipFindById.mockResolvedValue({ ...membership, role: 'ADMIN' })

    await expect(organizationsService.updateMemberRole(1, 10, 'ADMIN', { role: 'MEMBER' })).rejects.toThrow('ADMINは他のADMINを操作')
    expect(updateRole).not.toHaveBeenCalled()
  })

  test('ADMINがMEMBERをADMINに昇格しようとすると403エラーを投げる', async () => {
    membershipFindById.mockResolvedValue(membership)

    await expect(organizationsService.updateMemberRole(1, 10, 'ADMIN', { role: 'ADMIN' })).rejects.toThrow('ADMINはADMINへの昇格')
    expect(updateRole).not.toHaveBeenCalled()
  })

  test('対象がOWNERなら409エラーを投げる', async () => {
    membershipFindById.mockResolvedValue({ ...membership, role: 'OWNER' })

    await expect(organizationsService.updateMemberRole(1, 10, 'OWNER', { role: 'MEMBER' })).rejects.toThrow('OWNERのロールは変更')
    expect(updateRole).not.toHaveBeenCalled()
  })

  test('MEMBERは操作できず403エラーを投げる', async () => {
    await expect(organizationsService.updateMemberRole(1, 10, 'MEMBER', { role: 'MEMBER' })).rejects.toThrow('管理者以上')
    expect(updateRole).not.toHaveBeenCalled()
  })

  test('対象メンバーシップが存在しなければ404エラーを投げる', async () => {
    membershipFindById.mockResolvedValue(null)

    await expect(organizationsService.updateMemberRole(1, 999, 'OWNER', { role: 'MEMBER' })).rejects.toThrow('メンバーが見つかりません')
    expect(updateRole).not.toHaveBeenCalled()
  })

  test('異なる組織のメンバーシップなら404エラーを投げる', async () => {
    membershipFindById.mockResolvedValue({ ...membership, organizationId: 99 })

    await expect(organizationsService.updateMemberRole(1, 10, 'OWNER', { role: 'MEMBER' })).rejects.toThrow('メンバーが見つかりません')
    expect(updateRole).not.toHaveBeenCalled()
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
    invitationCancel.mockResolvedValue({ ...invitation, status: 'CANCELED' })

    await organizationsService.cancelInvitation(1, 20, 'OWNER')

    expect(invitationCancel).toHaveBeenCalledWith(20)
  })

  test('OWNERはADMIN宛て招待をキャンセルできる', async () => {
    invitationFindById.mockResolvedValue({ ...invitation, role: 'ADMIN' })
    invitationCancel.mockResolvedValue({ ...invitation, role: 'ADMIN', status: 'CANCELED' })

    await organizationsService.cancelInvitation(1, 20, 'OWNER')

    expect(invitationCancel).toHaveBeenCalledWith(20)
  })

  test('ADMINはMEMBER宛て招待をキャンセルできる', async () => {
    invitationFindById.mockResolvedValue(invitation)
    invitationCancel.mockResolvedValue({ ...invitation, status: 'CANCELED' })

    await organizationsService.cancelInvitation(1, 20, 'ADMIN')

    expect(invitationCancel).toHaveBeenCalledWith(20)
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
