import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { createRouteTestContext, createSupabaseAuthMock } from './testSupport'

// Supabaseクライアントはケース用mockで差し替え、DBに依存せずroutesの挙動を検証する
const supabaseAuth = createSupabaseAuthMock()
const context = await createRouteTestContext({ boundaryOverrides: { supabase: { supabase: { auth: supabaseAuth.mocks } } } })
const { app } = context
const { signInWithPassword } = supabaseAuth.mocks

const supabaseUser = {
  id: '11111111-1111-4111-8111-111111111111',
  aud: 'authenticated',
  email: 'taro@example.com',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  created_at: '2026-01-01T00:00:00.000Z',
}

afterEach(() => {
  context.assertNoUnexpectedCalls()
})

afterAll(() => {
  context.cleanup()
})

describe('supabaseAuth login routes', () => {
  beforeEach(() => {
    supabaseAuth.reset()
    context.reset()
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
})
