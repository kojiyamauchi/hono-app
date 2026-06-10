import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { Organization } from '@/shared/organization/entities'

const createWithOwner = mock()
const findByUserId = mock()
const findById = mock()
const update = mock()
const deleteById = mock()

await mock.module('@/shared/organization/repositories', () => ({
  organizationRepository: { createWithOwner, findByUserId, findById, update, deleteById },
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
