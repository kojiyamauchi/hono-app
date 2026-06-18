import { describe, expect, test } from 'bun:test'

// app読み込み前に必要な環境変数を設定する（CORSの許可Originはapp構築時に評価される）
process.env.JWT_SECRET = 'test-secret'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret'
process.env.ALLOWED_ORIGINS = 'http://localhost:3000'

const { app } = await import('./app')

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

describe('CORS（資格情報付き）', () => {
  test('許可OriginのpreflightにはAllow-Origin一致とAllow-Credentials: trueを返す', async () => {
    const response = await app.request('/auth/login', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3000',
        'Access-Control-Request-Method': 'POST',
      },
    })

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000')
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true')
  })

  test('未許可OriginのpreflightにはAllow-Originを返さない', async () => {
    const response = await app.request('/auth/login', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://evil.example',
        'Access-Control-Request-Method': 'POST',
      },
    })

    expect(response.headers.get('Access-Control-Allow-Origin')).not.toBe('http://evil.example')
  })
})
