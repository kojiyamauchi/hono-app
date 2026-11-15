import { beforeEach, describe, expect, mock, test } from 'bun:test'

// Supabaseクライアントをモックし、DBに依存せずserviceのロジックを検証する
const signUp = mock()

await mock.module('@/libs/supabase', () => ({
  supabase: { auth: { signUp } },
}))

const { signupService } = await import('./signup')

describe('signupService.execute', () => {
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

    const result = await signupService.execute({ email: 'taro@example.com', password: 'password123' })

    expect(result.token).toBe('token-abc')
    expect(result.user?.email).toBe('taro@example.com')
  })

  test('Supabaseがエラーを返したら400を投げる', async () => {
    signUp.mockResolvedValue({
      data: { session: null, user: null },
      error: { message: 'User already registered' },
    })

    await expect(signupService.execute({ email: 'taro@example.com', password: 'password123' })).rejects.toThrow('User already registered')
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

    const result = await signupService.execute({ email: 'taro@example.com', password: 'password123' })

    expect(result).toEqual({ token: null, user })
  })
})
