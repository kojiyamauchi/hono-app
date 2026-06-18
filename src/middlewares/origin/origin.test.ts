import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import { AppError } from '@/utils/errors'

const { originMiddleware } = await import('.')

/**
 * テスト用アプリ: originMiddlewareを経由してHello worldを返す。
 * AppErrorをstatusCodeに変換するonErrorハンドラを追加する。
 */
const app = new Hono()
  .post('/test', originMiddleware, (c) => c.text('ok', 200))
  .onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { message: err.message } }, err.statusCode as ContentfulStatusCode)
    }
    return c.json({ error: { message: 'サーバーエラー' } }, 500)
  })

describe('originMiddleware', () => {
  beforeEach(() => {
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000,http://example.com'
  })

  test('Originヘッダーなしのリクエストは通す', async () => {
    const response = await app.request('/test', { method: 'POST' })

    expect(response.status).toBe(200)
  })

  test('Origin=nullのリクエストは403を返す', async () => {
    const response = await app.request('/test', {
      method: 'POST',
      headers: { Origin: 'null' },
    })

    expect(response.status).toBe(403)
  })

  test('許可リストに一致するOriginは通す', async () => {
    const response = await app.request('/test', {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000' },
    })

    expect(response.status).toBe(200)
  })

  test('許可リストに一致する2つ目のOriginも通す', async () => {
    const response = await app.request('/test', {
      method: 'POST',
      headers: { Origin: 'http://example.com' },
    })

    expect(response.status).toBe(200)
  })

  test('許可リストに一致しないOriginは403を返す', async () => {
    const response = await app.request('/test', {
      method: 'POST',
      headers: { Origin: 'http://evil.com' },
    })

    expect(response.status).toBe(403)
  })

  test('ALLOWED_ORIGINSが未設定の場合はOriginありのリクエストを403で拒否する', async () => {
    const original = process.env.ALLOWED_ORIGINS
    delete process.env.ALLOWED_ORIGINS

    try {
      const response = await app.request('/test', {
        method: 'POST',
        headers: { Origin: 'http://localhost:3000' },
      })

      expect(response.status).toBe(403)
    } finally {
      process.env.ALLOWED_ORIGINS = original
    }
  })

  test('ALLOWED_ORIGINSが未設定でOriginなしのリクエストは通す', async () => {
    const original = process.env.ALLOWED_ORIGINS
    delete process.env.ALLOWED_ORIGINS

    try {
      const response = await app.request('/test', { method: 'POST' })

      expect(response.status).toBe(200)
    } finally {
      process.env.ALLOWED_ORIGINS = original
    }
  })
})
