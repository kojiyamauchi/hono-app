import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { createRouteTestContext, createSupabaseAuthMock } from './testSupport'

// Supabaseクライアントはケース用mockで差し替え、DBに依存せずroutesの挙動を検証する
const supabaseAuth = createSupabaseAuthMock()
const context = await createRouteTestContext({ boundaryOverrides: { supabase: { supabase: { auth: supabaseAuth.mocks } } } })
const { app } = context
const { signUp } = supabaseAuth.mocks

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

describe('supabaseAuth signup routes', () => {
  beforeEach(() => {
    supabaseAuth.reset()
    context.reset()
  })

  test('POST /supabase-auth/signup は成功時にトークンとユーザーを返す', async () => {
    // SDKの完全な応答ではなく、ケースに必要な項目だけの応答を返すため、このケースに限って型を迂回する
    signUp.mockResolvedValue({
      data: { session: { access_token: 'token-abc' }, user: supabaseUser },
      error: null,
    } as never)

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
