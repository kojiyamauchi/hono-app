import { describe, expect, test } from 'bun:test'

import { app } from './app'

describe('GET /health', () => {
  test('正常状態を返す', async () => {
    const response = await app.request('/health')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })
})

describe('POST /auth/signup（バリデーション）', () => {
  test('不正な入力は統一エラー形式 { error: { message } } で400を返す', async () => {
    const response = await app.request('/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', email: 'invalid', password: 'x' }),
    })

    expect(response.status).toBe(400)
    const body = (await response.json()) as { error?: { message?: string } }
    expect(body.error?.message).toBeDefined()
  })
})
