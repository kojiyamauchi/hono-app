import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import { AppError } from '@/utils/errors'

const requestPasswordReset = mock()

await mock.module('../../services/passwordReset', () => ({ passwordResetService: { request: requestPasswordReset } }))

const { passwordResetController } = await import('../passwordReset')

/**
 * テスト用アプリ。AppErrorをstatusCodeへ変換するonErrorを追加する。
 */
const app = new Hono()
  .post('/password-reset/request', (c) => passwordResetController.request(c, { email: 'taro@example.com' }))
  .onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { message: err.message } }, err.statusCode as ContentfulStatusCode)
    }
    return c.json({ error: { message: 'サーバーエラー' } }, 500)
  })

beforeEach(() => {
  requestPasswordReset.mockReset()
})

describe('passwordResetController', () => {
  test('password-reset/requestは信頼するエッジがx-forwarded-forの末尾へ追記したIPをserviceへ渡す', async () => {
    requestPasswordReset.mockResolvedValue(undefined)

    const response = await app.request('/password-reset/request', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.10, 198.51.100.20' },
    })

    expect(response.status).toBe(202)
    expect(requestPasswordReset).toHaveBeenCalledWith('taro@example.com', '198.51.100.20')
  })

  test('password-reset/requestはx-forwarded-forが無い場合にx-real-ipを信用しない', async () => {
    requestPasswordReset.mockResolvedValue(undefined)

    const response = await app.request('/password-reset/request', {
      method: 'POST',
      headers: { 'x-real-ip': '198.51.100.20' },
    })

    expect(response.status).toBe(202)
    expect(requestPasswordReset).toHaveBeenCalledWith('taro@example.com', undefined)
  })

  test('password-reset/requestはIPヘッダが無い場合にundefinedをserviceへ渡す', async () => {
    requestPasswordReset.mockResolvedValue(undefined)

    const response = await app.request('/password-reset/request', { method: 'POST' })

    expect(response.status).toBe(202)
    expect(requestPasswordReset).toHaveBeenCalledWith('taro@example.com', undefined)
  })
})
