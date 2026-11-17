import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import { AppError } from '@/utils/errors'

process.env.JWT_SECRET = 'test-secret'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret'

const login = mock()

await mock.module('../../services/login', () => ({ loginService: { execute: login } }))

const { loginController } = await import('../login')

/**
 * テスト用アプリ。AppErrorをstatusCodeへ変換するonErrorを追加する。
 */
const app = new Hono()
  .post('/login', (c) => loginController.execute(c, { email: 'taro@example.com', password: 'password123' }))
  .onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { message: err.message } }, err.statusCode as ContentfulStatusCode)
    }
    return c.json({ error: { message: 'サーバーエラー' } }, 500)
  })

beforeEach(() => {
  login.mockReset()
})

describe('loginController', () => {
  test.each([
    { label: 'IPv6', header: '203.0.113.10, 2001:db8::10', expectedIp: '2001:db8::10' },
    { label: '前後の空白', header: '203.0.113.10,  198.51.100.20 ', expectedIp: '198.51.100.20' },
    { label: '不正な末尾', header: '203.0.113.10, invalid', expectedIp: undefined },
    { label: '空の末尾', header: '203.0.113.10, ', expectedIp: undefined },
  ])('loginの転送ヘッダーを検証する（$label）', async ({ header, expectedIp }) => {
    login.mockResolvedValue({ token: 'access-token', refreshToken: 'refresh-token', user: { id: 1, name: 'Taro', email: 'taro@example.com' } })

    const response = await app.request('/login', { method: 'POST', headers: { 'x-forwarded-for': header, 'x-real-ip': '192.0.2.10' } })

    expect(response.status).toBe(200)
    expect(login).toHaveBeenCalledWith({ email: 'taro@example.com', password: 'password123' }, expectedIp)
  })

  test('loginは信頼するエッジがx-forwarded-forの末尾へ追記したIPをserviceの第2引数へ渡す', async () => {
    login.mockResolvedValue({
      token: 'access-token',
      refreshToken: 'next-refresh-token',
      user: { id: 1, name: 'Taro', email: 'taro@example.com' },
    })

    const response = await app.request('/login', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.10, 198.51.100.20' },
    })

    expect(response.status).toBe(200)
    expect(login).toHaveBeenCalledWith({ email: 'taro@example.com', password: 'password123' }, '198.51.100.20')
  })

  test('loginはIPヘッダが無い場合にundefinedをserviceの第2引数へ渡す', async () => {
    login.mockResolvedValue({
      token: 'access-token',
      refreshToken: 'next-refresh-token',
      user: { id: 1, name: 'Taro', email: 'taro@example.com' },
    })

    const response = await app.request('/login', { method: 'POST' })

    expect(response.status).toBe(200)
    expect(login).toHaveBeenCalledWith({ email: 'taro@example.com', password: 'password123' }, undefined)
  })
})
