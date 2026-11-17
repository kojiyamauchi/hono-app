import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'

import {
  createEmailVerificationServiceMock,
  createEmailVerificationTokenRepositoryMock,
  createRefreshTokenRepositoryMock,
  createUserRepositoryMock,
  installEmailVerificationServiceMock,
  installEmailVerificationTokenRepositoryMock,
  installRefreshTokenRepositoryMock,
  installUserRepositoryMock,
  setTestEnv,
} from './testSupport'

// JWT・リフレッシュトークンの発行に必要なシークレットだけをテスト用に設定する
const env = setTestEnv({ JWT_SECRET: 'test-secret', REFRESH_TOKEN_SECRET: 'test-refresh-secret' })

const refreshTokens = createRefreshTokenRepositoryMock()
const users = createUserRepositoryMock()
const emailVerificationService = createEmailVerificationServiceMock()
await installRefreshTokenRepositoryMock(refreshTokens.mocks)
await installUserRepositoryMock(users.mocks)
// 実モジュールを読み込む部分mockの前提として、メール検証トークンRepositoryを差し替える（本テストでは呼び出さない）
await installEmailVerificationTokenRepositoryMock(createEmailVerificationTokenRepositoryMock().mocks)
await installEmailVerificationServiceMock(emailVerificationService.mocks)
const { create: createRefreshToken } = refreshTokens.mocks
const { findByEmail, create } = users.mocks
const { sendEmailVerificationBestEffort } = emailVerificationService.mocks

const { signupService, signupRateLimiter, SIGNUP_IP_RATE_LIMIT } = await import('../signup')

beforeEach(() => {
  refreshTokens.reset()
  users.reset()
  emailVerificationService.reset()
  // rate limiterは対象を読み込んだ後に同じインスタンスをresetする
  signupRateLimiter.reset()
})

afterAll(() => {
  env.restore()
})

describe('signupService.execute', () => {
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
      emailVerifiedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))

    const result = await signupService.execute({
      name: 'Taro',
      email: 'taro@example.com',
      password: 'password123',
    })

    expect(typeof result.token).toBe('string')
    expect(typeof result.refreshToken).toBe('string')
    expect(result.user.email).toBe('taro@example.com')
    expect(result.user.emailVerified).toBe(false)
    expect(result.user).not.toHaveProperty('password')
    expect(createRefreshToken).toHaveBeenCalledTimes(1)
    expect(sendEmailVerificationBestEffort).toHaveBeenCalledWith(1, 'taro@example.com')

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
      emailVerifiedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await expect(signupService.execute({ name: 'Taro', email: 'taro@example.com', password: 'password123' })).rejects.toThrow('既に登録')
  })

  test('findByEmailをすり抜けたcreateの一意制約違反（null）は409へ変換する', async () => {
    // findByEmailは未登録を返すが、同時signupの競合でcreateがP2002によりnullを返すケース
    findByEmail.mockResolvedValue(null)
    create.mockResolvedValue(null)

    await expect(signupService.execute({ name: 'Taro', email: 'taro@example.com', password: 'password123' })).rejects.toMatchObject({
      statusCode: 409,
    })
    // 認証トークンは発行されない
    expect(createRefreshToken).not.toHaveBeenCalled()
  })

  test('同一IPからSIGNUP_IP_RATE_LIMIT回の後、次の試行は429エラーを投げる', async () => {
    findByEmail.mockResolvedValue(null)
    create.mockImplementation(async (input: { name: string; email: string; password: string }) => ({
      id: 1,
      name: input.name,
      email: input.email,
      password: input.password,
      emailVerifiedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
    const infoSpy = spyOn(console, 'info').mockImplementation(() => {})

    try {
      for (let i = 0; i < SIGNUP_IP_RATE_LIMIT; i++) {
        await expect(signupService.execute({ name: 'Taro', email: `user-${i}@example.com`, password: 'password123' }, '203.0.113.20')).resolves.toBeDefined()
      }

      await expect(signupService.execute({ name: 'Taro', email: 'user-overflow@example.com', password: 'password123' }, '203.0.113.20')).rejects.toMatchObject({
        statusCode: 429,
      })
    } finally {
      infoSpy.mockRestore()
    }
  })

  test('clientIp未指定の場合はIP単位の制限がかからない', async () => {
    findByEmail.mockResolvedValue(null)
    create.mockImplementation(async (input: { name: string; email: string; password: string }) => ({
      id: 1,
      name: input.name,
      email: input.email,
      password: input.password,
      emailVerifiedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))

    for (let i = 0; i < SIGNUP_IP_RATE_LIMIT + 1; i++) {
      await expect(signupService.execute({ name: 'Taro', email: `user-${i}@example.com`, password: 'password123' })).resolves.toBeDefined()
    }
  })
})
