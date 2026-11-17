import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { createRouteTestContext, createSupabaseAuthMock } from './testSupport'

// Supabaseクライアントはケース用mockで差し替え、DBに依存せずroutesの挙動を検証する
const supabaseAuth = createSupabaseAuthMock()
const context = await createRouteTestContext({ boundaryOverrides: { supabase: { supabase: { auth: supabaseAuth.mocks } } } })
const { app } = context
const { getUser } = supabaseAuth.mocks

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

describe('supabaseAuth me routes', () => {
  beforeEach(() => {
    supabaseAuth.reset()
    context.reset()
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
