import { beforeEach, describe, expect, test } from 'bun:test'

import { createRefreshTokenRepositoryMock, installRefreshTokenRepositoryMock } from './testSupport'

const refreshTokens = createRefreshTokenRepositoryMock()
await installRefreshTokenRepositoryMock(refreshTokens.mocks)
const { revokeAllByUserId } = refreshTokens.mocks

const { logoutAllService } = await import('../logoutAll')

beforeEach(() => {
  refreshTokens.reset()
})

describe('logoutAllService.execute', () => {
  test('全リフレッシュトークンを失効させるためrevokeAllByUserIdをuserIdで呼び出す', async () => {
    revokeAllByUserId.mockResolvedValue(2)

    await logoutAllService.execute(1)

    expect(revokeAllByUserId).toHaveBeenCalledWith(1)
  })

  test('失効対象が存在しない場合（revokeAllByUserId が0件）も正常終了する', async () => {
    revokeAllByUserId.mockResolvedValue(0)

    await expect(logoutAllService.execute(1)).resolves.toBeUndefined()
  })
})
