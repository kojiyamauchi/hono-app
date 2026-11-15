import { describe, expect, test } from 'bun:test'

import { authResultDto, supabaseUserDto } from '.'

/** 現実的なSupabase User fixture。 */
const supabaseUserFixture = {
  id: '11111111-1111-4111-8111-111111111111',
  aud: 'authenticated',
  email: 'taro@example.com',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  email_confirmed_at: '2026-01-01T00:00:00.000Z',
  last_sign_in_at: '2026-01-01T00:00:00.000Z',
  is_anonymous: false,
}

describe('supabaseUserDto', () => {
  test('現実的なSupabase Userのfixtureを受け付ける', () => {
    const result = supabaseUserDto.safeParse(supabaseUserFixture)
    expect(result.success).toBe(true)
  })

  test('必須フィールド（id）が欠落していたら拒否する', () => {
    const { id: _id, ...rest } = supabaseUserFixture
    const result = supabaseUserDto.safeParse(rest)
    expect(result.success).toBe(false)
  })
})

describe('authResultDto', () => {
  test('token/userが揃った認証結果を受け付ける', () => {
    const result = authResultDto.safeParse({ token: 'token-abc', user: supabaseUserFixture })
    expect(result.success).toBe(true)
  })

  test('token/userがnullの認証結果を受け付ける', () => {
    const result = authResultDto.safeParse({ token: null, user: null })
    expect(result.success).toBe(true)
  })
})
