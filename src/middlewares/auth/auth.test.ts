import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { sign } from 'hono/jwt'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import { AppError } from '@/utils/errors'

const { authMiddleware } = await import('.')

const JWT_SECRET = 'test-secret'

/**
 * テスト用アプリ: authMiddlewareを経由してcontextのuserIdを返す。
 * AppErrorをstatusCodeに変換するonErrorハンドラを追加する。
 */
const app = new Hono<{ Variables: { userId: number } }>()
  .get('/test', authMiddleware, (c) => c.json({ userId: c.get('userId') }, 200))
  .onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { message: err.message } }, err.statusCode as ContentfulStatusCode)
    }
    return c.json({ error: { message: 'サーバーエラー' } }, 500)
  })

/**
 * 任意のpayloadでHS256署名済みトークンを発行し、Authorizationヘッダー付きでリクエストする。
 */
const requestWithPayload = async (payload: Record<string, unknown>): Promise<Response> => {
  const token = await sign(payload, JWT_SECRET, 'HS256')

  return app.request('/test', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

describe('authMiddleware', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = JWT_SECRET
  })

  test('subが正の整数のトークンは通し、userIdをcontextに格納する', async () => {
    const response = await requestWithPayload({ sub: 1 })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ userId: 1 })
  })

  test('subが正の整数の文字列でも通す', async () => {
    const response = await requestWithPayload({ sub: '42' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ userId: 42 })
  })

  test('Authorizationヘッダーなしのリクエストは401を返す', async () => {
    const response = await app.request('/test')

    expect(response.status).toBe(401)
  })

  test('subが欠落したトークンは401を返す', async () => {
    const response = await requestWithPayload({ foo: 'bar' })

    expect(response.status).toBe(401)
  })

  test('subが非数値文字列のトークンは401を返す', async () => {
    const response = await requestWithPayload({ sub: 'abc' })

    expect(response.status).toBe(401)
  })

  test('subが空文字のトークンは401を返す', async () => {
    const response = await requestWithPayload({ sub: '' })

    expect(response.status).toBe(401)
  })

  test('subが0のトークンは401を返す', async () => {
    const response = await requestWithPayload({ sub: 0 })

    expect(response.status).toBe(401)
  })

  test('subが負数のトークンは401を返す', async () => {
    const response = await requestWithPayload({ sub: -1 })

    expect(response.status).toBe(401)
  })

  test('subが小数のトークンは401を返す', async () => {
    const response = await requestWithPayload({ sub: 1.5 })

    expect(response.status).toBe(401)
  })

  test('subがboolean(true)のトークンは401を返す', async () => {
    const response = await requestWithPayload({ sub: true })

    expect(response.status).toBe(401)
  })

  test('subが配列のトークンは401を返す', async () => {
    const response = await requestWithPayload({ sub: [1] })

    expect(response.status).toBe(401)
  })

  test('subが指数表記文字列のトークンは401を返す', async () => {
    const response = await requestWithPayload({ sub: '1e2' })

    expect(response.status).toBe(401)
  })

  test('subが小数表記文字列のトークンは401を返す', async () => {
    const response = await requestWithPayload({ sub: '1.0' })

    expect(response.status).toBe(401)
  })
})
