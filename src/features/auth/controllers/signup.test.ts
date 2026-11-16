import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import { AppError } from '@/utils/errors'

process.env.JWT_SECRET = 'test-secret'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret'

const signup = mock()

await mock.module('../services/signup', () => ({ signupService: { execute: signup } }))

const { signupController } = await import('./signup')

/**
 * テスト用アプリ。AppErrorをstatusCodeへ変換するonErrorを追加する。
 */
const app = new Hono()
  .post('/signup', (c) => signupController.execute(c, { name: 'Taro', email: 'taro@example.com', password: 'password123' }))
  .onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { message: err.message } }, err.statusCode as ContentfulStatusCode)
    }
    return c.json({ error: { message: 'サーバーエラー' } }, 500)
  })

beforeEach(() => {
  signup.mockReset()
})

describe('signupController', () => {
  test('signupは信頼するエッジがx-forwarded-forの末尾へ追記したIPをserviceの第2引数へ渡す', async () => {
    signup.mockResolvedValue({
      token: 'access-token',
      refreshToken: 'next-refresh-token',
      user: { id: 1, name: 'Taro', email: 'taro@example.com' },
    })

    const response = await app.request('/signup', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.10, 198.51.100.20' },
    })

    expect(response.status).toBe(201)
    expect(signup).toHaveBeenCalledWith({ name: 'Taro', email: 'taro@example.com', password: 'password123' }, '198.51.100.20')
  })

  test('signupはIPヘッダが無い場合にundefinedをserviceの第2引数へ渡す', async () => {
    signup.mockResolvedValue({
      token: 'access-token',
      refreshToken: 'next-refresh-token',
      user: { id: 1, name: 'Taro', email: 'taro@example.com' },
    })

    const response = await app.request('/signup', { method: 'POST' })

    expect(response.status).toBe(201)
    expect(signup).toHaveBeenCalledWith({ name: 'Taro', email: 'taro@example.com', password: 'password123' }, undefined)
  })
})
