import { beforeEach, describe, expect, mock, test } from 'bun:test'

// Supabaseクライアントをモックし、DBに依存せずroutesの挙動を検証する
const getUser = mock()

await mock.module('@/libs/supabase', () => ({
  supabase: { auth: { getUser } },
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

describe('supabaseAuth me routes', () => {
  beforeEach(() => {
    getUser.mockReset()
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
