import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { Organization } from '@/shared/organization/entities'

const createWithOwner = mock()
const findPageByUserId = mock()
const findById = mock()
const update = mock()
const deleteById = mock()

await mock.module('@/shared/organization/repositories', () => ({
  organizationRepository: { createWithOwner, findPageByUserId, findById, update, deleteById },
}))

const { service } = await import('..')

const organization: Organization = {
  id: 1,
  name: 'Acme',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
}

describe('service.create', () => {
  beforeEach(() => {
    createWithOwner.mockReset()
  })

  test('組織を作成し、作成者をOWNERとして登録する', async () => {
    createWithOwner.mockResolvedValue(organization)

    const result = await service.create(1, { name: 'Acme' })

    expect(createWithOwner).toHaveBeenCalledWith('Acme', 1)
    expect(result.name).toBe('Acme')
  })
})

describe('service.listMine', () => {
  const organizations = (count: number): Organization[] => Array.from({ length: count }, (_, index) => ({ ...organization, id: index + 1 }))

  beforeEach(() => {
    findPageByUserId.mockReset()
  })

  test('次ページ判定のためlimit + 1件をrepositoryへ要求し、offsetをそのまま渡す', async () => {
    findPageByUserId.mockResolvedValue([])

    await service.listMine(1, 20, 40)

    expect(findPageByUserId).toHaveBeenCalledWith(1, 21, 40)
  })

  test('0件ならitemsは空でhasNextはfalseになる', async () => {
    findPageByUserId.mockResolvedValue([])

    const result = await service.listMine(1, 20, 0)

    expect(result).toEqual({ items: [], limit: 20, offset: 0, hasNext: false })
  })

  test('limit未満ならhasNextはfalseになる', async () => {
    findPageByUserId.mockResolvedValue(organizations(2))

    const result = await service.listMine(1, 3, 0)

    expect(result.items).toHaveLength(2)
    expect(result.hasNext).toBe(false)
  })

  test('limit件ちょうどならhasNextはfalseになる', async () => {
    findPageByUserId.mockResolvedValue(organizations(3))

    const result = await service.listMine(1, 3, 0)

    expect(result.items).toHaveLength(3)
    expect(result.hasNext).toBe(false)
  })

  test('limitを超えて取得できたらhasNextはtrueになり、itemsはlimit件に切り詰める', async () => {
    findPageByUserId.mockResolvedValue(organizations(4))

    const result = await service.listMine(1, 3, 0)

    expect(result.items.map((item) => item.id)).toEqual([1, 2, 3])
    expect(result).toMatchObject({ limit: 3, offset: 0, hasNext: true })
  })

  test('取得対象件数以上のoffsetならitemsは空でhasNextはfalseになる', async () => {
    findPageByUserId.mockResolvedValue([])

    const result = await service.listMine(1, 20, 10000)

    expect(result).toEqual({ items: [], limit: 20, offset: 10000, hasNext: false })
  })
})

describe('service.getById', () => {
  beforeEach(() => {
    findById.mockReset()
  })

  test('存在しない組織なら404エラーを投げる', async () => {
    findById.mockResolvedValue(null)

    await expect(service.getById(999)).rejects.toThrow('組織が見つかりません')
  })
})

describe('service.update', () => {
  beforeEach(() => {
    update.mockReset()
  })

  test('OWNERは更新できる', async () => {
    update.mockResolvedValue({ ...organization, name: 'New Name' })

    const result = await service.update(1, { name: 'New Name' }, 'OWNER')

    expect(result.name).toBe('New Name')
  })

  test('ADMINは更新できる', async () => {
    update.mockResolvedValue({ ...organization, name: 'New Name' })

    const result = await service.update(1, { name: 'New Name' }, 'ADMIN')

    expect(result.name).toBe('New Name')
  })

  test('MEMBERは更新できず403エラーを投げる', async () => {
    await expect(service.update(1, { name: 'New Name' }, 'MEMBER')).rejects.toThrow('管理者以上')
    expect(update).not.toHaveBeenCalled()
  })

  test('組織が存在しなければ404エラーを投げる', async () => {
    update.mockResolvedValue(null)

    await expect(service.update(999, { name: 'New Name' }, 'OWNER')).rejects.toThrow('組織が見つかりません')
  })
})

describe('service.remove', () => {
  beforeEach(() => {
    deleteById.mockReset()
  })

  test('OWNERは削除できる', async () => {
    deleteById.mockResolvedValue(true)

    await service.remove(1, 'OWNER')

    expect(deleteById).toHaveBeenCalledWith(1)
  })

  test('ADMINは削除できず403エラーを投げる', async () => {
    await expect(service.remove(1, 'ADMIN')).rejects.toThrow('オーナー')
    expect(deleteById).not.toHaveBeenCalled()
  })

  test('MEMBERは削除できず403エラーを投げる', async () => {
    await expect(service.remove(1, 'MEMBER')).rejects.toThrow('オーナー')
    expect(deleteById).not.toHaveBeenCalled()
  })

  test('組織が存在しなければ404エラーを投げる', async () => {
    deleteById.mockResolvedValue(false)

    await expect(service.remove(999, 'OWNER')).rejects.toThrow('組織が見つかりません')
  })
})
