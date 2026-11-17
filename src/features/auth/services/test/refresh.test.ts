import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import type { RefreshToken } from '@/shared/auth/entities/refreshToken'
import type { User } from '@/shared/user/entities'

import {
  createRefreshTokenRepositoryMock,
  createUserRepositoryMock,
  installRefreshTokenRepositoryMock,
  installUserRepositoryMock,
  setTestEnv,
} from './testSupport'

// JWT・リフレッシュトークンの発行とハッシュ化に必要なシークレットだけをテスト用に設定する
const env = setTestEnv({ JWT_SECRET: 'test-secret', REFRESH_TOKEN_SECRET: 'test-refresh-secret' })

const refreshTokens = createRefreshTokenRepositoryMock()
const users = createUserRepositoryMock()
await installRefreshTokenRepositoryMock(refreshTokens.mocks)
await installUserRepositoryMock(users.mocks)
const { findByTokenHash, revokeById, revokeFamily, rotate } = refreshTokens.mocks
const { findById } = users.mocks

const { refreshService } = await import('../refresh')

const user: User = {
  id: 1,
  name: 'Taro',
  email: 'taro@example.com',
  password: 'hashed',
  emailVerifiedAt: null,
  createdAt: new Date('2026-06-18T00:00:00.000Z'),
  updatedAt: new Date('2026-06-18T00:00:00.000Z'),
}

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
  users.reset()
})

afterAll(() => {
  env.restore()
})

describe('refreshService.execute', () => {
  beforeEach(() => {
    findByTokenHash.mockResolvedValue(refreshToken)
    findById.mockResolvedValue(user)
    rotate.mockResolvedValue({ status: 'ROTATED', refreshToken: { ...refreshToken, id: 11 } })
  })

  test('有効なトークンをローテーションして新しい認証結果を返す', async () => {
    const result = await refreshService.execute('plain-refresh-token')

    expect(typeof result.token).toBe('string')
    expect(typeof result.refreshToken).toBe('string')
    expect(result.refreshToken).not.toBe('plain-refresh-token')
    expect(result.user.id).toBe(1)
    expect(rotate).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ userId: 1, familyId: 'family-id', tokenHash: expect.any(String), expiresAt: expect.any(Date) }),
    )
  })

  test('存在しないトークンは401エラーを投げる', async () => {
    findByTokenHash.mockResolvedValue(null)

    await expect(refreshService.execute('unknown-token')).rejects.toThrow('リフレッシュトークンが無効です')
    expect(rotate).not.toHaveBeenCalled()
  })

  test('失効済みトークンの再提示はfamilyを失効して401エラーを投げる', async () => {
    findByTokenHash.mockResolvedValue({ ...refreshToken, revokedAt: new Date() })

    await expect(refreshService.execute('revoked-token')).rejects.toThrow('リフレッシュトークンが無効です')
    expect(revokeFamily).toHaveBeenCalledWith('family-id')
    expect(findById).not.toHaveBeenCalled()
  })

  test('期限切れトークンは当該トークンを失効して401エラーを投げる', async () => {
    findByTokenHash.mockResolvedValue({ ...refreshToken, expiresAt: new Date(Date.now() - 1) })

    await expect(refreshService.execute('expired-token')).rejects.toThrow('リフレッシュトークンが無効です')
    expect(revokeById).toHaveBeenCalledWith(10)
    expect(rotate).not.toHaveBeenCalled()
  })

  test('ユーザーが存在しない場合はfamilyを失効して401エラーを投げる', async () => {
    findById.mockResolvedValue(null)

    await expect(refreshService.execute('orphan-token')).rejects.toThrow('リフレッシュトークンが無効です')
    expect(revokeFamily).toHaveBeenCalledWith('family-id')
    expect(rotate).not.toHaveBeenCalled()
  })

  test('条件付き失効が競合した場合はcommit後の再利用結果を401へ変換する', async () => {
    rotate.mockResolvedValue({ status: 'REUSED' })

    await expect(refreshService.execute('reused-token')).rejects.toThrow('リフレッシュトークンが無効です')
  })

  test('未知の結果値はエラー側へ倒れる（fail-closed）', async () => {
    // 未知のresult unionを作るため、このケースに限って型を迂回する
    rotate.mockResolvedValue({ status: 'UNKNOWN' } as never)

    await expect(refreshService.execute('unknown-status-token')).rejects.toThrow('リフレッシュトークンが無効です')
  })

  test('アクセストークンを発行できない場合はローテーションしない', async () => {
    const jwtSecret = process.env.JWT_SECRET
    delete process.env.JWT_SECRET

    try {
      await expect(refreshService.execute('plain-refresh-token')).rejects.toThrow('JWT_SECRETが設定されていません')
      expect(rotate).not.toHaveBeenCalled()
    } finally {
      process.env.JWT_SECRET = jwtSecret
    }
  })
})
