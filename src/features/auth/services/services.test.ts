import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { RefreshToken } from '@/shared/auth/entities'
import type { User } from '@/shared/user/entities'

// JWT発行に必要なシークレットをテスト用に設定
process.env.JWT_SECRET = 'test-secret'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret'

const createRefreshToken = mock()
const findByTokenHash = mock()
const revokeById = mock()
const revokeFamily = mock()
const rotate = mock()

await mock.module('@/shared/auth/repositories', () => ({
  refreshTokenRepository: {
    create: createRefreshToken,
    findByTokenHash,
    revokeById,
    revokeFamily,
    rotate,
  },
}))

// userRepositoryをモックし、DBに依存せずserviceのロジックを検証する
const findByEmail = mock()
const create = mock()
const findById = mock()

await mock.module('@/shared/user/repositories', () => ({
  userRepository: { findByEmail, create, findById },
}))

const { authService } = await import('.')

const user: User = {
  id: 1,
  name: 'Taro',
  email: 'taro@example.com',
  password: 'hashed',
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
  createRefreshToken.mockReset()
  findByTokenHash.mockReset()
  revokeById.mockReset()
  revokeFamily.mockReset()
  rotate.mockReset()
  findById.mockReset()
})

describe('authService.signup', () => {
  beforeEach(() => {
    findByEmail.mockReset()
    create.mockReset()
  })

  test('新規メールなら登録し、トークンとパスワードを除いたユーザーを返す', async () => {
    findByEmail.mockResolvedValue(null)
    create.mockImplementation(async (input: { name: string; email: string; password: string }) => ({
      id: 1,
      name: input.name,
      email: input.email,
      password: input.password,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))

    const result = await authService.signup({
      name: 'Taro',
      email: 'taro@example.com',
      password: 'password123',
    })

    expect(typeof result.token).toBe('string')
    expect(typeof result.refreshToken).toBe('string')
    expect(result.user.email).toBe('taro@example.com')
    expect(result.user).not.toHaveProperty('password')
    expect(createRefreshToken).toHaveBeenCalledTimes(1)

    // パスワードはハッシュ化されて保存される（平文のままでない）
    const createdInput = create.mock.calls[0][0] as { password: string }
    expect(createdInput.password).not.toBe('password123')
  })

  test('既存メールなら409エラーを投げる', async () => {
    findByEmail.mockResolvedValue({
      id: 1,
      name: 'Existing',
      email: 'taro@example.com',
      password: 'hashed',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await expect(authService.signup({ name: 'Taro', email: 'taro@example.com', password: 'password123' })).rejects.toThrow('既に登録')
  })
})

describe('authService.login', () => {
  beforeEach(() => {
    findByEmail.mockReset()
  })

  test('正しいパスワードならトークンを返す', async () => {
    const hashed = await Bun.password.hash('password123')
    findByEmail.mockResolvedValue({
      id: 1,
      name: 'Taro',
      email: 'taro@example.com',
      password: hashed,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const result = await authService.login({ email: 'taro@example.com', password: 'password123' })

    expect(typeof result.token).toBe('string')
    expect(typeof result.refreshToken).toBe('string')
    expect(result.user.email).toBe('taro@example.com')
    expect(createRefreshToken).toHaveBeenCalledTimes(1)
  })

  test('誤ったパスワードなら401エラーを投げる', async () => {
    const hashed = await Bun.password.hash('password123')
    findByEmail.mockResolvedValue({
      id: 1,
      name: 'Taro',
      email: 'taro@example.com',
      password: hashed,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await expect(authService.login({ email: 'taro@example.com', password: 'wrong-password' })).rejects.toThrow('正しくありません')
  })

  test('ユーザーが存在しないなら401エラーを投げる', async () => {
    findByEmail.mockResolvedValue(null)

    await expect(authService.login({ email: 'none@example.com', password: 'password123' })).rejects.toThrow('正しくありません')
  })
})

describe('authService.refresh', () => {
  beforeEach(() => {
    findByTokenHash.mockResolvedValue(refreshToken)
    findById.mockResolvedValue(user)
    rotate.mockResolvedValue({ status: 'ROTATED', refreshToken: { ...refreshToken, id: 11 } })
  })

  test('有効なトークンをローテーションして新しい認証結果を返す', async () => {
    const result = await authService.refresh('plain-refresh-token')

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

    await expect(authService.refresh('unknown-token')).rejects.toThrow('リフレッシュトークンが無効です')
    expect(rotate).not.toHaveBeenCalled()
  })

  test('失効済みトークンの再提示はfamilyを失効して401エラーを投げる', async () => {
    findByTokenHash.mockResolvedValue({ ...refreshToken, revokedAt: new Date() })

    await expect(authService.refresh('revoked-token')).rejects.toThrow('リフレッシュトークンが無効です')
    expect(revokeFamily).toHaveBeenCalledWith('family-id')
    expect(findById).not.toHaveBeenCalled()
  })

  test('期限切れトークンは当該トークンを失効して401エラーを投げる', async () => {
    findByTokenHash.mockResolvedValue({ ...refreshToken, expiresAt: new Date(Date.now() - 1) })

    await expect(authService.refresh('expired-token')).rejects.toThrow('リフレッシュトークンが無効です')
    expect(revokeById).toHaveBeenCalledWith(10)
    expect(rotate).not.toHaveBeenCalled()
  })

  test('ユーザーが存在しない場合はfamilyを失効して401エラーを投げる', async () => {
    findById.mockResolvedValue(null)

    await expect(authService.refresh('orphan-token')).rejects.toThrow('リフレッシュトークンが無効です')
    expect(revokeFamily).toHaveBeenCalledWith('family-id')
    expect(rotate).not.toHaveBeenCalled()
  })

  test('条件付き失効が競合した場合はcommit後の再利用結果を401へ変換する', async () => {
    rotate.mockResolvedValue({ status: 'REUSED' })

    await expect(authService.refresh('reused-token')).rejects.toThrow('リフレッシュトークンが無効です')
  })

  test('アクセストークンを発行できない場合はローテーションしない', async () => {
    const jwtSecret = process.env.JWT_SECRET
    delete process.env.JWT_SECRET

    try {
      await expect(authService.refresh('plain-refresh-token')).rejects.toThrow('JWT_SECRETが設定されていません')
      expect(rotate).not.toHaveBeenCalled()
    } finally {
      process.env.JWT_SECRET = jwtSecret
    }
  })
})

describe('authService.logout', () => {
  test('トークンが存在する場合はfamilyを失効する', async () => {
    findByTokenHash.mockResolvedValue(refreshToken)

    await expect(authService.logout('plain-refresh-token')).resolves.toBeUndefined()
    expect(revokeFamily).toHaveBeenCalledWith('family-id')
  })

  test('トークンが存在しない場合も成功する', async () => {
    findByTokenHash.mockResolvedValue(null)

    await expect(authService.logout('unknown-token')).resolves.toBeUndefined()
    expect(revokeFamily).not.toHaveBeenCalled()
  })
})
