import { beforeEach, describe, expect, mock, test } from 'bun:test'

// Supabaseクライアントをモックし、DBに依存せずroutesの挙動を検証する
const signUp = mock()
const signInWithPassword = mock()
const getUser = mock()

await mock.module('@/libs/supabase', () => ({
  supabase: { auth: { signUp, signInWithPassword, getUser } },
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

describe('supabaseAuth routes', () => {
  beforeEach(() => {
    signUp.mockReset()
    signInWithPassword.mockReset()
    getUser.mockReset()
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

  test('POST /supabase-auth/login は成功時にトークンとユーザーを返す', async () => {
    signInWithPassword.mockResolvedValue({
      data: { session: { access_token: 'token-xyz' }, user: supabaseUser },
      error: null,
    })

    const response = await app.request('/supabase-auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'taro@example.com', password: 'password123' }),
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { token?: string; user?: { id?: string } }
    expect(body.token).toBe('token-xyz')
    expect(body.user?.id).toBe(supabaseUser.id)
  })

  test('POST /supabase-auth/login は認証失敗時に401と統一エラー形式を返す', async () => {
    signInWithPassword.mockResolvedValue({
      data: { session: null, user: null },
      error: { message: 'Invalid login credentials' },
    })

    const response = await app.request('/supabase-auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'taro@example.com', password: 'wrong-password' }),
    })

    expect(response.status).toBe(401)
    const body = (await response.json()) as { error?: { message?: string } }
    expect(body.error?.message).toBeDefined()
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

  test('GET /supabase-auth/me はトークンがなければ401を返す', async () => {
    const response = await app.request('/supabase-auth/me')

    expect(response.status).toBe(401)
    expect(getUser).not.toHaveBeenCalled()
  })

  test('GET /supabase-auth/me は認証済みユーザー情報を返す', async () => {
    getUser.mockResolvedValue({ data: { user: supabaseUser }, error: null })

    const response = await app.request('/supabase-auth/me', {
      headers: { Authorization: 'Bearer valid-token' },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { id?: string }
    expect(body.id).toBe(supabaseUser.id)
  })
})
