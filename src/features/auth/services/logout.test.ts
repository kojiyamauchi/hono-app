import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import type { RefreshToken } from '@/shared/auth/entities/refreshToken'

import { createRefreshTokenRepositoryMock, installRefreshTokenRepositoryMock, setTestEnv } from './testSupport'

// hashRefreshTokenが読むシークレットだけをテスト用に設定する
const env = setTestEnv({ REFRESH_TOKEN_SECRET: 'test-refresh-secret' })

const refreshTokens = createRefreshTokenRepositoryMock()
await installRefreshTokenRepositoryMock(refreshTokens.mocks)
const { findByTokenHash, revokeFamily } = refreshTokens.mocks

const { logoutService } = await import('./logout')

const refreshToken: RefreshToken = {
  id: 10,
  userId: 1,
  familyId: 'family-id',
  tokenHash: 'token-hash',
  expiresAt: new Date(Date.now() + 60_000),
  revokedAt: null,
  createdAt: new Date('2026-06-18T00:00:00.000Z'),
}

beforeEach(() => {
  refreshTokens.reset()
})

afterAll(() => {
  env.restore()
})

describe('logoutService.execute', () => {
  test('トークンが存在する場合はfamilyを失効する', async () => {
    findByTokenHash.mockResolvedValue(refreshToken)

    await expect(logoutService.execute('plain-refresh-token')).resolves.toBeUndefined()
    expect(revokeFamily).toHaveBeenCalledWith('family-id')
  })

  test('トークンが存在しない場合も成功する', async () => {
    findByTokenHash.mockResolvedValue(null)

    await expect(logoutService.execute('unknown-token')).resolves.toBeUndefined()
    expect(revokeFamily).not.toHaveBeenCalled()
  })
})
