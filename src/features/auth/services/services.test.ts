import { beforeEach, describe, expect, mock, test } from 'bun:test'

// JWT発行に必要なシークレットをテスト用に設定
process.env.JWT_SECRET = 'test-secret'

// userRepositoryをモックし、DBに依存せずserviceのロジックを検証する
const findByEmail = mock()
const create = mock()
const findById = mock()

await mock.module('@/shared/user/repositories', () => ({
  userRepository: { findByEmail, create, findById },
}))

const { authService } = await import('.')

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
    expect(result.user.email).toBe('taro@example.com')
    expect(result.user).not.toHaveProperty('password')

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
    expect(result.user.email).toBe('taro@example.com')
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
