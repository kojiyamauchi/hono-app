import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

process.env.JWT_SECRET = 'test-jwt-secret'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret'

const { clearRefreshTokenCookie, getRefreshTokenCookie, REFRESH_TOKEN_COOKIE_NAME, REFRESH_TOKEN_TTL_MS, setRefreshTokenCookie } = await import('.')

/**
 * Set-Cookieヘッダーから属性をパースするヘルパー。
 * 最初のname=valueペアはCookieName（大文字小文字区別）をキーとし、
 * 2番目以降の属性名はlowercaseをキーとするMapを返す。
 */
const parseCookieAttributes = (setCookieHeader: string): Map<string, string> => {
  const parts = setCookieHeader.split(';').map((s) => s.trim())
  const attrs = new Map<string, string>()
  parts.forEach((part, index) => {
    const eqIdx = part.indexOf('=')
    if (eqIdx === -1) {
      // 値なし属性（HttpOnly, Secure等）は lowercase をキーとする
      attrs.set(part.toLowerCase(), '')
    } else {
      const key = part.slice(0, eqIdx)
      const value = part.slice(eqIdx + 1)
      // 最初のペアはCookieName（大文字小文字区別）、以降はlowercaseで格納する
      attrs.set(index === 0 ? key : key.toLowerCase(), value)
    }
  })
  return attrs
}

describe('setRefreshTokenCookie', () => {
  test('HttpOnly・Path=/auth・SameSite=Laxの属性でCookieをセットする', async () => {
    const app = new Hono().post('/test', (c) => {
      setRefreshTokenCookie(c, 'test-token')
      return c.text('ok')
    })

    const response = await app.request('/test', { method: 'POST' })
    const setCookie = response.headers.get('set-cookie')

    expect(setCookie).not.toBeNull()
    const attrs = parseCookieAttributes(setCookie!)

    expect(attrs.get(REFRESH_TOKEN_COOKIE_NAME)).toBe('test-token')
    expect(attrs.has('httponly')).toBe(true) // cspell:ignore httponly
    expect(attrs.get('path')).toBe('/auth')
    expect(attrs.get('samesite')).toBe('Lax')
  })

  test('MaxAgeがリフレッシュトークンTTLと一致する', async () => {
    const app = new Hono().post('/test', (c) => {
      setRefreshTokenCookie(c, 'test-token')
      return c.text('ok')
    })

    const response = await app.request('/test', { method: 'POST' })
    const setCookie = response.headers.get('set-cookie')!
    const attrs = parseCookieAttributes(setCookie)

    const expectedMaxAge = Math.floor(REFRESH_TOKEN_TTL_MS / 1000)
    expect(attrs.get('max-age')).toBe(String(expectedMaxAge))
  })

  test('非本番環境ではSecure属性が付かない', async () => {
    const original = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'

    try {
      const app = new Hono().post('/test', (c) => {
        setRefreshTokenCookie(c, 'test-token')
        return c.text('ok')
      })

      const response = await app.request('/test', { method: 'POST' })
      const setCookie = response.headers.get('set-cookie')!
      const attrs = parseCookieAttributes(setCookie)

      expect(attrs.has('secure')).toBe(false)
    } finally {
      process.env.NODE_ENV = original
    }
  })

  test('本番環境ではSecure属性が付く', async () => {
    const original = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'

    try {
      const app = new Hono().post('/test', (c) => {
        setRefreshTokenCookie(c, 'test-token')
        return c.text('ok')
      })

      const response = await app.request('/test', { method: 'POST' })
      const setCookie = response.headers.get('set-cookie')!
      const attrs = parseCookieAttributes(setCookie)

      expect(attrs.has('secure')).toBe(true)
    } finally {
      process.env.NODE_ENV = original
    }
  })
})

describe('getRefreshTokenCookie', () => {
  test('Cookieヘッダーからリフレッシュトークンを取得する', async () => {
    let gotToken: string | undefined

    const app = new Hono().get('/test', (c) => {
      gotToken = getRefreshTokenCookie(c)
      return c.text('ok')
    })

    await app.request('/test', {
      method: 'GET',
      headers: { Cookie: `${REFRESH_TOKEN_COOKIE_NAME}=my-refresh-token` },
    })

    expect(gotToken).toBe('my-refresh-token')
  })

  test('Cookieが存在しない場合はundefinedを返す', async () => {
    let gotToken: string | undefined = 'initial'

    const app = new Hono().get('/test', (c) => {
      gotToken = getRefreshTokenCookie(c)
      return c.text('ok')
    })

    await app.request('/test', { method: 'GET' })

    expect(gotToken).toBeUndefined()
  })
})

describe('clearRefreshTokenCookie', () => {
  test('削除時にPath=/authが指定される', async () => {
    const app = new Hono().post('/test', (c) => {
      clearRefreshTokenCookie(c)
      return c.text('ok')
    })

    const response = await app.request('/test', { method: 'POST' })
    const setCookie = response.headers.get('set-cookie')!
    const attrs = parseCookieAttributes(setCookie)

    expect(attrs.get('path')).toBe('/auth')
  })

  test('削除時にHttpOnlyとSameSite=Laxが指定される', async () => {
    const app = new Hono().post('/test', (c) => {
      clearRefreshTokenCookie(c)
      return c.text('ok')
    })

    const response = await app.request('/test', { method: 'POST' })
    const setCookie = response.headers.get('set-cookie')!
    const attrs = parseCookieAttributes(setCookie)

    expect(attrs.has('httponly')).toBe(true) // cspell:ignore httponly
    expect(attrs.get('samesite')).toBe('Lax')
  })
})
