import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'

import type { User } from '@/shared/user/entities'

import {
  createEmailVerificationTokenRepositoryMock,
  createRefreshTokenRepositoryMock,
  createUserRepositoryMock,
  installEmailVerificationTokenRepositoryMock,
  installRefreshTokenRepositoryMock,
  installUserRepositoryMock,
  setTestEnv,
} from './testSupport'

// JWT・リフレッシュトークンの発行と、レート制限キーのHMAC化に必要なシークレットだけをテスト用に設定する
const env = setTestEnv({
  JWT_SECRET: 'test-secret',
  REFRESH_TOKEN_SECRET: 'test-refresh-secret',
  PASSWORD_RESET_TOKEN_SECRET: 'test-password-reset-secret',
})

const refreshTokens = createRefreshTokenRepositoryMock()
const users = createUserRepositoryMock()
await installRefreshTokenRepositoryMock(refreshTokens.mocks)
await installUserRepositoryMock(users.mocks)
// ./signup（レート制限の定数確認）が読み込むshared層がメール検証トークンRepositoryに依存するため差し替える（呼び出さない）
await installEmailVerificationTokenRepositoryMock(createEmailVerificationTokenRepositoryMock().mocks)
const { create: createRefreshToken } = refreshTokens.mocks
const { findByEmail } = users.mocks

const { loginService, loginRateLimiter, LOGIN_IP_RATE_LIMIT, LOGIN_IP_RATE_LIMIT_WINDOW_MS, LOGIN_EMAIL_RATE_LIMIT, LOGIN_EMAIL_RATE_LIMIT_WINDOW_MS } =
  await import('./login')
const { SIGNUP_IP_RATE_LIMIT, SIGNUP_IP_RATE_LIMIT_WINDOW_MS } = await import('./signup')

const user: User = {
  id: 1,
  name: 'Taro',
  email: 'taro@example.com',
  password: 'hashed',
  emailVerifiedAt: null,
  createdAt: new Date('2026-06-18T00:00:00.000Z'),
  updatedAt: new Date('2026-06-18T00:00:00.000Z'),
}

beforeEach(() => {
  refreshTokens.reset()
  users.reset()
  // rate limiterは対象を読み込んだ後に同じインスタンスをresetする
  loginRateLimiter.reset()
})

afterAll(() => {
  env.restore()
})

describe('loginService.execute', () => {
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
      emailVerifiedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const result = await loginService.execute({ email: 'taro@example.com', password: 'password123' })

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
      emailVerifiedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await expect(loginService.execute({ email: 'taro@example.com', password: 'wrong-password' })).rejects.toThrow('正しくありません')
  })

  test('ユーザーが存在しないなら401エラーを投げる', async () => {
    findByEmail.mockResolvedValue(null)

    await expect(loginService.execute({ email: 'none@example.com', password: 'password123' })).rejects.toThrow('正しくありません')
  })

  test('同一IPからLOGIN_IP_RATE_LIMIT回成功した後、同一IPの次の試行は429エラーを投げる', async () => {
    const hashed = await Bun.password.hash('password123')
    findByEmail.mockResolvedValue({ ...user, password: hashed })
    const infoSpy = spyOn(console, 'info').mockImplementation(() => {})

    try {
      for (let i = 0; i < LOGIN_IP_RATE_LIMIT; i++) {
        await expect(loginService.execute({ email: `user-${i}@example.com`, password: 'password123' }, '203.0.113.30')).resolves.toBeDefined()
      }

      await expect(loginService.execute({ email: 'user-overflow@example.com', password: 'password123' }, '203.0.113.30')).rejects.toMatchObject({
        statusCode: 429,
      })
    } finally {
      infoSpy.mockRestore()
    }
  })

  test('email単位でLOGIN_EMAIL_RATE_LIMIT回試行後、異なるIP（またはclientIp未指定）からでも同一emailの次の試行は429エラーを投げる', async () => {
    findByEmail.mockResolvedValue(null)
    const infoSpy = spyOn(console, 'info').mockImplementation(() => {})

    try {
      for (let i = 0; i < LOGIN_EMAIL_RATE_LIMIT; i++) {
        await expect(loginService.execute({ email: 'taro@example.com', password: 'wrong-password' }, `203.0.113.${40 + i}`)).rejects.toMatchObject({
          statusCode: 401,
        })
      }

      await expect(loginService.execute({ email: 'taro@example.com', password: 'password123' })).rejects.toMatchObject({
        statusCode: 429,
      })
    } finally {
      infoSpy.mockRestore()
    }
  })

  test('email単位の制限超過時はuserRepository.findByEmailが呼ばれない（ユーザー存在確認より前に適用される）', async () => {
    findByEmail.mockResolvedValue(null)
    const infoSpy = spyOn(console, 'info').mockImplementation(() => {})

    try {
      for (let i = 0; i < LOGIN_EMAIL_RATE_LIMIT; i++) {
        await expect(loginService.execute({ email: 'taro@example.com', password: 'wrong-password' })).rejects.toMatchObject({
          statusCode: 401,
        })
      }
      findByEmail.mockClear()

      await expect(loginService.execute({ email: 'taro@example.com', password: 'password123' })).rejects.toMatchObject({
        statusCode: 429,
      })
      expect(findByEmail).not.toHaveBeenCalled()
    } finally {
      infoSpy.mockRestore()
    }
  })

  test('emailは正規化される（大文字/前後空白の違いは同一キー扱い）', async () => {
    findByEmail.mockResolvedValue(null)
    const infoSpy = spyOn(console, 'info').mockImplementation(() => {})

    try {
      await loginService.execute({ email: ' TARO@example.com ', password: 'wrong-password' }).catch(() => {})
      await loginService.execute({ email: 'taro@example.com', password: 'wrong-password' }).catch(() => {})
      await loginService.execute({ email: 'Taro@Example.com', password: 'wrong-password' }).catch(() => {})
      await loginService.execute({ email: 'taro@example.com', password: 'wrong-password' }).catch(() => {})
      await loginService.execute({ email: 'taro@example.com', password: 'wrong-password' }).catch(() => {})

      await expect(loginService.execute({ email: 'TARO@EXAMPLE.COM', password: 'password123' })).rejects.toMatchObject({
        statusCode: 429,
      })
    } finally {
      infoSpy.mockRestore()
    }
  })

  test('clientIp未指定の場合はIP単位の制限がかからない（email制限のみ適用される）', async () => {
    const hashed = await Bun.password.hash('password123')

    for (let i = 0; i < LOGIN_IP_RATE_LIMIT + 1; i++) {
      findByEmail.mockResolvedValue({ ...user, email: `user-${i}@example.com`, password: hashed })
      await expect(loginService.execute({ email: `user-${i}@example.com`, password: 'password123' })).resolves.toBeDefined()
    }
  })

  test('異なるIPは互いの制限に影響しない', async () => {
    const hashed = await Bun.password.hash('password123')
    findByEmail.mockResolvedValue({ ...user, password: hashed })

    for (let i = 0; i < LOGIN_IP_RATE_LIMIT; i++) {
      await expect(loginService.execute({ email: `user-a-${i}@example.com`, password: 'password123' }, '203.0.113.100')).resolves.toBeDefined()
    }

    // 別IPからは制限に影響されず成功する
    await expect(loginService.execute({ email: 'user-b@example.com', password: 'password123' }, '203.0.113.200')).resolves.toBeDefined()
  })

  test('定数値の検証（5回・15分=900000ms）', () => {
    expect(LOGIN_IP_RATE_LIMIT).toBe(5)
    expect(LOGIN_IP_RATE_LIMIT_WINDOW_MS).toBe(900000)
    expect(LOGIN_EMAIL_RATE_LIMIT).toBe(5)
    expect(LOGIN_EMAIL_RATE_LIMIT_WINDOW_MS).toBe(900000)
    expect(SIGNUP_IP_RATE_LIMIT).toBe(5)
    expect(SIGNUP_IP_RATE_LIMIT_WINDOW_MS).toBe(900000)
  })
})
