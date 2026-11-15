import { beforeEach, describe, expect, mock, test } from 'bun:test'

// Supabaseクライアントをモックし、DBに依存せずroutesの挙動を検証する
const signUp = mock()

await mock.module('@/libs/supabase', () => ({
  supabase: { auth: { signUp } },
}))

const { app } = await import('@/app')

const supabaseUser = {
  id: '11111111-1111-4111-8111-111111111111',
  aud: 'authenticated',
  email: 'taro@example.com',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  created_at: '2026-01-01T00:00:00.000Z',
}

describe('supabaseAuth signup routes', () => {
  beforeEach(() => {
    signUp.mockReset()
  })

  test('POST /supabase-auth/signup は成功時にトークンとユーザーを返す', async () => {
    signUp.mockResolvedValue({
      data: { session: { access_token: 'token-abc' }, user: supabaseUser },
      error: null,
    })

    const response = await app.request('/supabase-auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'taro@example.com', password: 'password123' }),
    })

    expect(response.status).toBe(201)
    const body = (await response.json()) as { token?: string; user?: { id?: string } }
    expect(body.token).toBe('token-abc')
    expect(body.user?.id).toBe(supabaseUser.id)
  })

  test('POST /supabase-auth/signup は不正なbodyなら400と統一エラー形式を返し、Supabaseは呼ばれない', async () => {
    const response = await app.request('/supabase-auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'password123' }),
    })

    expect(response.status).toBe(400)
    const body = (await response.json()) as { error?: { message?: string } }
    expect(body.error?.message).toBeDefined()
    expect(signUp).not.toHaveBeenCalled()
  })
})
