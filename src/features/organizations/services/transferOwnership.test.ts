import { beforeEach, describe, expect, mock, test } from 'bun:test'

const transferOwnership = mock()

await mock.module('@/features/organizations/repositories/transferOwnership', () => ({
  transferOwnershipRepository: { execute: transferOwnership },
  ownershipTransferResults: {
    transferred: 'TRANSFERRED',
    targetNotFound: 'TARGET_NOT_FOUND',
    selfTransfer: 'SELF_TRANSFER',
    conflict: 'CONFLICT',
  },
}))

const { transferOwnershipService } = await import('./transferOwnership')

describe('transferOwnershipService.execute', () => {
  beforeEach(() => {
    transferOwnership.mockReset()
  })

  test('OWNERは同じ組織のメンバーへ所有権を移譲できる', async () => {
    transferOwnership.mockResolvedValue('TRANSFERRED')

    await transferOwnershipService.execute(1, 1, 'OWNER', 2)

    expect(transferOwnership).toHaveBeenCalledWith(1, 1, 2)
  })

  test('OWNER以外は403エラーになる', async () => {
    await expect(transferOwnershipService.execute(1, 1, 'ADMIN', 2)).rejects.toMatchObject({ statusCode: 403 })

    expect(transferOwnership).not.toHaveBeenCalled()
  })

  test('移譲先が存在しないか別組織なら404エラーになる', async () => {
    transferOwnership.mockResolvedValue('TARGET_NOT_FOUND')

    await expect(transferOwnershipService.execute(1, 1, 'OWNER', 999)).rejects.toMatchObject({ statusCode: 404 })
  })

  test('自分自身への移譲は422エラーになる', async () => {
    transferOwnership.mockResolvedValue('SELF_TRANSFER')

    await expect(transferOwnershipService.execute(1, 1, 'OWNER', 1)).rejects.toMatchObject({ statusCode: 422 })
  })

  test('ロック待機後の再検証で競合した場合は409エラーになる', async () => {
    transferOwnership.mockResolvedValue('CONFLICT')

    await expect(transferOwnershipService.execute(1, 1, 'OWNER', 2)).rejects.toMatchObject({ statusCode: 409 })
  })
})
