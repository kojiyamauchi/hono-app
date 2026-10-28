import { beforeEach, describe, expect, mock, test } from 'bun:test'

// Supabaseクライアントをモックし、DBに依存せずserviceのロジックを検証する
const signUp = mock()
const signInWithPassword = mock()

await mock.module('@/libs/supabase', () => ({
  supabase: { auth: { signUp, signInWithPassword } },
}))

const { supabaseAuthService } = await import('.')

describe('supabaseAuthService.signup', () => {
  beforeEach(() => {
    signUp.mockReset()
  })

  test('成功時はトークンとユーザーを返す', async () => {
    signUp.mockResolvedValue({
      data: {
        session: { access_token: 'token-abc' },
        user: { id: 'user-1', email: 'taro@example.com' },
      },
      error: null,
    })

    const result = await supabaseAuthService.signup({ email: 'taro@example.com', password: 'password123' })

    expect(result.token).toBe('token-abc')
    expect(result.user?.email).toBe('taro@example.com')
  })

  test('Supabaseがエラーを返したら400を投げる', async () => {
    signUp.mockResolvedValue({
      data: { session: null, user: null },
      error: { message: 'User already registered' },
    })

    await expect(supabaseAuthService.signup({ email: 'taro@example.com', password: 'password123' })).rejects.toThrow('User already registered')
  })

  test('確認メール待ちでセッションがない場合もユーザーとnullのトークンを返す', async () => {
    const user = {
      id: 'user-1',
      email: 'taro@example.com',
      aud: 'authenticated',
      app_metadata: { provider: 'email' },
      user_metadata: {},
      created_at: '2026-01-01T00:00:00.000Z',
    }
    signUp.mockResolvedValue({ data: { session: null, user }, error: null })

    const result = await supabaseAuthService.signup({ email: 'taro@example.com', password: 'password123' })

    expect(result).toEqual({ token: null, user })
  })
})

describe('supabaseAuthService.login', () => {
  beforeEach(() => {
    signInWithPassword.mockReset()
  })

  test('成功時はトークンとユーザーを返す', async () => {
    signInWithPassword.mockResolvedValue({
      data: {
        session: { access_token: 'token-xyz' },
        user: { id: 'user-1', email: 'taro@example.com' },
      },
      error: null,
    })

    const result = await supabaseAuthService.login({ email: 'taro@example.com', password: 'password123' })

    expect(result.token).toBe('token-xyz')
    expect(result.user?.email).toBe('taro@example.com')
  })

  test('Supabaseがエラーを返したら401を投げる', async () => {
    signInWithPassword.mockResolvedValue({
      data: { session: null, user: null },
      error: { message: 'Invalid login credentials' },
    })

    await expect(supabaseAuthService.login({ email: 'taro@example.com', password: 'wrong-password' })).rejects.toThrow('正しくありません')
  })
})
